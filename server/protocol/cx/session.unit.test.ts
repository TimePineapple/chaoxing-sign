import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Cx } from '.'
import { CxSessionExpiredError, isCxLoginHtml, isCxLoginUrl } from './session'
import { createError } from 'h3'

vi.mock('~/server/utils/cxRequestStartQueue', () => ({ cxRequestStartQueue: { waitTurn: async () => {} } }))

let server: http.Server | undefined
beforeEach(() => vi.stubEnv('CX_PROXY_URL', ''))
afterEach(async () => {
  vi.unstubAllEnvs()
  if (server) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server!.close(() => resolve()))
    server = undefined
  }
})

async function origin(handler: http.RequestListener) {
  server = http.createServer(handler)
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('learning session expiry detection', () => {
  it('requires a known login URL or a definite login form', () => {
    expect(isCxLoginUrl('https://passport2.chaoxing.com/login?refer=x')).toBe(true)
    expect(isCxLoginUrl('https://passport2-api.chaoxing.com/fanyalogin')).toBe(true)
    expect(isCxLoginUrl('https://passport2.chaoxing.com.evil.test/login')).toBe(false)
    expect(isCxLoginUrl('https://passport2.chaoxing.com/api/login')).toBe(false)
    expect(isCxLoginHtml('<html><p>暂无课程</p></html>')).toBe(false)
    expect(isCxLoginHtml('<form action="https://passport2.chaoxing.com/login"><input type="password"></form>')).toBe(true)
    expect(isCxLoginHtml('<form action="http://["><input type="password"></form>')).toBe(false)
  })

  it('serializes a structured 409 account error through the normal H3 error handler', () => {
    const error = createError(new CxSessionExpiredError('cx-a', '2026-10-01T00:00:00.000Z'))
    expect(error.toJSON()).toMatchObject({ statusCode: 409, message: '登陆状态失效，请重新登录',
      data: { code: 'CX_SESSION_EXPIRED', uid: 'cx-a', lastLoginTime: '2026-10-01T00:00:00.000Z' } })
  })

  it('stops a redirect before following the login page and returns a safe 409 error', async () => {
    const url = await origin((_req, res) => res.writeHead(302, { location: 'https://passport2.chaoxing.com/login' }).end())
    const cx = new Cx({ uid: 'cx-a', logged: true })
    cx.sessionLoginTime = '2026-10-01T00:00:00.000Z'
    cx.onSessionExpired = vi.fn().mockResolvedValue(undefined)
    const error = await cx.http.get(url, { retry: { limit: 0 } }).catch(error => error)
    expect(error).toBeInstanceOf(CxSessionExpiredError)
    expect(error).toMatchObject({ statusCode: 409, code: 'CX_SESSION_EXPIRED',
      data: { uid: 'cx-a', lastLoginTime: cx.sessionLoginTime } })
    expect(cx.user.logged).toBe(false)
    expect(cx.onSessionExpired).toHaveBeenCalled()
    expect(error.options.url).toBeUndefined()
  })

  it.each(['text', 'json'] as const)('recognizes login HTML with a %s response type, preserving existing courses', async (responseType) => {
    const url = await origin((_req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<form action="https://passport2.chaoxing.com/login"><input type="password"></form>')
    })
    const cx = new Cx({ uid: 'cx-a', logged: true })
    cx.courseList = [{ courseId: 'old', classId: 'class' }] as CX.Course[]
    await expect(cx.http.get(url, { responseType, retry: { limit: 0 } })).rejects.toMatchObject({ code: 'CX_SESSION_EXPIRED' })
    expect(cx.courseList[0].courseId).toBe('old')
  })

  it('does not expire an account for empty HTML, normal redirects or a plain 403', async () => {
    const url = await origin((req, res) => {
      if (req.url === '/redirect')
        res.writeHead(302, { location: '/empty' }).end()
      else if (req.url === '/denied')
        res.writeHead(403).end('Forbidden')
      else
        res.end('<html>暂无课程</html>')
    })
    const cx = new Cx({ uid: 'cx-a', logged: true })
    await expect(cx.http.get(`${url}/redirect`, { responseType: 'text' }).text()).resolves.toContain('暂无课程')
    await expect(cx.http.get(`${url}/denied`, { responseType: 'text', retry: { limit: 0 } }).text()).rejects.toMatchObject({ response: { statusCode: 403 } })
    expect(cx.user.logged).toBe(true)
  })
})
