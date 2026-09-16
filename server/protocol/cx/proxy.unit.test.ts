import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'
import got from 'got'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Cx } from '.'
import { createCxProxyOptions, CxProxyError, getCxProxyOptions } from './proxy'

// Public test-only key and certificate. Never used by the application.
const key = readFileSync(new URL('./fixtures/proxy-test-key.pem', import.meta.url))
const cert = readFileSync(new URL('./fixtures/proxy-test-cert.pem', import.meta.url))
const cleanup: (() => Promise<void>)[] = []

async function listen(server: http.Server | https.Server) {
  const sockets = new Set<net.Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve) => {
    for (const socket of sockets) socket.destroy()
    server.close(() => resolve())
  }))
  return `127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function origin(secure = false) {
  const requests: string[] = []
  const handler: http.RequestListener = (req, res) => {
    requests.push(req.url!)
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/final' }).end()
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, proxyAuth: req.headers['proxy-authorization'] || null }))
  }
  const server = secure ? https.createServer({ key, cert }, handler) : http.createServer(handler)
  return { url: `${secure ? 'https' : 'http'}://${await listen(server)}`, requests }
}

async function proxy(secure = false, expectedAuth?: string) {
  const visits: { method: string; url: string; auth?: string }[] = []
  const handler: http.RequestListener = (req, res) => {
    visits.push({ method: req.method!, url: req.url!, auth: req.headers['proxy-authorization'] })
    if (expectedAuth && req.headers['proxy-authorization'] !== expectedAuth) {
      res.writeHead(407, { 'Content-Type': 'text/html' }).end('Proxy authentication required')
      return
    }
    const headers = { ...req.headers }
    delete headers['proxy-authorization']
    const upstream = http.request(req.url!, { method: req.method, headers }, (response) => {
      res.writeHead(response.statusCode!, response.headers)
      response.pipe(res)
    })
    upstream.on('error', () => res.writeHead(502).end())
    req.pipe(upstream)
  }
  const server = secure ? https.createServer({ key, cert }, handler) : http.createServer(handler)
  server.on('connect', (req, client, head) => {
    visits.push({ method: 'CONNECT', url: req.url!, auth: req.headers['proxy-authorization'] })
    if (expectedAuth && req.headers['proxy-authorization'] !== expectedAuth) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const target = new URL(`http://${req.url}`)
    const upstream = net.connect(Number(target.port), target.hostname, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
    })
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.on('close', () => upstream.destroy())
  })
  return { url: `${secure ? 'https' : 'http'}://${await listen(server)}`, visits }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})

describe('learning service proxy', () => {
  it('keeps empty configuration direct', async () => {
    const target = await origin()
    vi.stubEnv('CX_PROXY_URL', '  ')
    const cx = new Cx({})
    expect(createCxProxyOptions('')).toEqual({})
    await expect(cx.http.get(target.url).json()).resolves.toMatchObject({ ok: true })
    expect(target.requests).toHaveLength(1)
  })

  it.each(['not-a-url', 'socks5://localhost:1080', 'http://localhost:99999',
    'http://localhost/path', 'http://localhost?token=secret', 'http://localhost/#secret',
    'http://user:%zz@localhost'])('rejects invalid configuration: %s', (value) => {
    expect(() => createCxProxyOptions(value)).toThrow(CxProxyError)
    try { createCxProxyOptions(value) }
    catch (error) { expect(inspect(error)).not.toContain(value) }
  })

  it('shares agents across accounts but keeps cookie jars separate', () => {
    vi.stubEnv('CX_PROXY_URL', 'http://127.0.0.1:7890')
    const options = getCxProxyOptions()
    const a = new Cx({})
    const b = new Cx({})
    expect(getCxProxyOptions()).toBe(options)
    expect(a.http.defaults.options.agent.http).toBe(b.http.defaults.options.agent.http)
    expect(a.cookieJar).not.toBe(b.cookieJar)
  })

  it('forwards HTTP and redirects through the configured proxy with encoded credentials', async () => {
    const target = await origin()
    const auth = `Basic ${Buffer.from('test-user:p@ss:#').toString('base64')}`
    const relay = await proxy(false, auth)
    vi.stubEnv('CX_PROXY_URL', relay.url.replace('://', '://test-user:p%40ss%3A%23@'))
    const cx = new Cx({})
    await expect(cx.http.get(`${target.url}/redirect`).json()).resolves.toEqual({ ok: true, proxyAuth: null })
    expect(relay.visits.map(v => v.url)).toEqual([`${target.url}/redirect`, `${target.url}/final`])
    expect(relay.visits.every(v => v.auth === auth)).toBe(true)
  })

  it('uses CONNECT for HTTPS and retains certificate verification', async () => {
    const target = await origin(true)
    const relay = await proxy()
    vi.stubEnv('CX_PROXY_URL', relay.url)
    const cx = new Cx({})
    await expect(cx.http.get(target.url, { retry: { limit: 0 } }).json()).rejects.toMatchObject({ code: 'ERR_CX_PROXY_CONNECTION' })
    await expect(cx.http.get(`${target.url}/redirect`, { https: { certificateAuthority: cert } }).json()).resolves.toMatchObject({ ok: true })
    expect(relay.visits.length).toBeGreaterThanOrEqual(3)
    expect(relay.visits.every(v => v.method === 'CONNECT')).toBe(true)
  })

  it.each([false, true])('supports a TLS proxy for secure target=%s', async (secureTarget) => {
    const target = await origin(secureTarget)
    const relay = await proxy(true)
    const options = createCxProxyOptions(relay.url)
    // Trust this test fixture only; production agents retain normal CA validation.
    for (const agent of Object.values(options.agent!))
      (agent as any).connectOpts.ca = cert
    await expect(got(target.url, { ...options, https: { certificateAuthority: cert } }).json()).resolves.toMatchObject({ ok: true })
    expect(relay.visits).toHaveLength(1)
  })

  it.each([false, true])('reports proxy authentication failures without secrets for HTTPS=%s', async (secureTarget) => {
    const target = await origin(secureTarget)
    const relay = await proxy(false, 'Basic expected')
    vi.stubEnv('CX_PROXY_URL', relay.url.replace('://', '://proxy-user:proxy-secret@'))
    const cx = new Cx({})
    const error = await cx.http.get(`${target.url}/?pwd=account-secret`, {
      headers: { cookie: 'session=cookie-secret' }, retry: { limit: 0 },
    }).catch(error => error)
    expect(error).toMatchObject({ code: 'ERR_CX_PROXY_AUTH' })
    const output = inspect(error, { depth: 20 })
    for (const secret of ['proxy-secret', 'proxy-user', 'account-secret', 'cookie-secret'])
      expect(output).not.toContain(secret)
    expect(target.requests).toHaveLength(0)
  })

  it('does not fall back to direct traffic when the proxy is unavailable', async () => {
    const target = await origin()
    const temporary = http.createServer()
    const deadAddress = await listen(temporary)
    await cleanup.pop()!()
    vi.stubEnv('CX_PROXY_URL', `http://${deadAddress}`)
    const cx = new Cx({})
    await expect(cx.http.get(target.url, { retry: { limit: 0 } }).json()).rejects.toMatchObject({ code: 'ERR_CX_PROXY_CONNECTION' })
    expect(target.requests).toHaveLength(0)
  })

  it('preserves upstream 403 diagnostics through a proxy', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: 'https://passport2-api.chaoxing.com/views/error/passport403.html' }).end()
    })
    vi.stubEnv('CX_PROXY_URL', `http://${await listen(server)}`)
    const cx = new Cx({ username: '13800000000', password: 'fixture-password' })
    // Test the real login hooks over plain HTTP so the fixture can emit a redirect.
    cx.http = cx.http.extend({ hooks: { beforeRequest: [(options) => {
      options.url = new URL('http://fixture.invalid/api/login')
    }] } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(cx.login()).rejects.toMatchObject({ code: 'ERR_CX_ACCESS_DENIED' })
  })
})
