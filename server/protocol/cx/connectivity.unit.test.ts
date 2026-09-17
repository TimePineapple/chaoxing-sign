import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkCxConnectivity, cxConnectivityErrorMessage, CX_LOGIN_PAGE_URL } from './connectivity'
import { Cx } from './index'
import { CxProxyError } from './proxy'

const servers: Server[] = []

function listen(handler: Parameters<typeof createServer>[0]) {
  return new Promise<string>((resolve) => {
    const server = createServer(handler)
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('fixture server did not expose a port')
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('learning service connectivity check', () => {
  it('targets the requested learning service login page', () => {
    expect(CX_LOGIN_PAGE_URL).toBe('https://passport2.chaoxing.com/login')
  })

  it('accepts a reachable page', async () => {
    vi.stubEnv('CX_PROXY_URL', '')
    const target = await listen((_req, res) => res.writeHead(200).end('login'))
    await expect(checkCxConnectivity(target)).resolves.toEqual({ ok: true })
  })

  it('returns a client-safe HTTP failure', async () => {
    vi.stubEnv('CX_PROXY_URL', '')
    const target = await listen((_req, res) => res.writeHead(503).end('private upstream response'))
    await expect(checkCxConnectivity(target)).resolves.toEqual({
      ok: false,
      message: '学习通登录页返回异常状态（HTTP 503）',
    })
  })

  it('reports a redirect loop without returning request details', async () => {
    vi.stubEnv('CX_PROXY_URL', '')
    const target = await listen((req, res) => res.writeHead(302, { location: req.url || '/' }).end())
    const result = await checkCxConnectivity(target)
    expect(result).toEqual({
      ok: false,
      message: '学习通登录页发生循环重定向，服务器出口可能已被限制',
    })
    expect(result.message).not.toContain(target)
  })

  it('preserves redirect-loop diagnostics after proxy error sanitization', () => {
    expect(cxConnectivityErrorMessage(new CxProxyError('ERR_TOO_MANY_REDIRECTS')))
      .toBe('学习通登录页发生循环重定向，服务器出口可能已被限制')
  })

  it('staggered connectivity and account requests can overlap while responses are pending', async () => {
    vi.stubEnv('CX_PROXY_URL', '')
    const started: number[] = []
    let releaseFirst!: () => void
    let firstArrived!: () => void
    const firstHit = new Promise<void>((resolve) => { firstArrived = resolve })
    const target = await listen((_req, res) => {
      started.push(Date.now())
      if (started.length === 1) {
        releaseFirst = () => res.writeHead(200).end('first')
        firstArrived()
      }
      else {
        res.writeHead(200).end('second')
      }
    })
    const cx = new Cx({ username: '', password: '' })
    const first = cx.http.get(target, { responseType: 'text', retry: { limit: 0 } })
    await firstHit
    const second = checkCxConnectivity(target)
    const secondResult = await Promise.race([
      second,
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 1500)),
    ])
    releaseFirst()
    await first
    expect(secondResult).toEqual({ ok: true })
    expect(started).toHaveLength(2)
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(190)
  })
})
