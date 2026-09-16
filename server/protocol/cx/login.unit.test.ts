import { afterEach, describe, expect, it, vi } from 'vitest'
import { Cx, CxLoginError } from '.'

const user = { username: '13800000000', password: 'fixture-password' }
const authenticated = { body: { result: true, uid: 123, realname: 'Test' } }

function upstreamError(code: string) {
  return Object.assign(new Error(`upstream URL contains pwd=${user.password}`), { code })
}

afterEach(() => vi.restoreAllMocks())

describe('Cx login failure handling', () => {
  it('stops the authentication redirect to the upstream access-denied page', async () => {
    const cx = new Cx({ ...user })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const get = vi.spyOn(cx.http, 'get').mockImplementation(((_url: unknown, options: any) => {
      return Promise.resolve().then(() => {
        options.hooks.beforeRedirect[0]({
          url: new URL('https://passport2-api.chaoxing.com/views/error/passport403.html'),
        })
      })
    }) as any)

    await expect(cx.login()).rejects.toMatchObject({
      stage: '认证',
      code: 'ERR_CX_ACCESS_DENIED',
      message: '学习通认证请求被拒绝（403），请检查服务器出口网络或联系学习通支持',
    })
    expect(get).toHaveBeenCalledTimes(1)
    expect(cx.user.logged).toBe(false)
  })

  it('uses HTTPS for the profile and preserves successful login', async () => {
    const cx = new Cx({ ...user })
    const get = vi.spyOn(cx.http, 'get')
      .mockResolvedValueOnce(authenticated as never)
      .mockResolvedValueOnce({ body: '<img class="head-img" src="https://example.test/avatar/"><div id="siteName" title="Test school"></div>' } as never)

    await expect(cx.login()).resolves.toBe('登录成功')
    const beforeRedirect = get.mock.calls[0][1]?.hooks?.beforeRedirect?.[0]
    expect(() => beforeRedirect?.({ url: new URL('https://passport2.chaoxing.com/login') } as any, {} as any)).not.toThrow()
    expect(get.mock.calls[1][0]).toMatch(/^https:\/\/i\.chaoxing\.com\/base\?t=/)
    expect(cx.user).toMatchObject({ uid: '123', logged: true, siteName: 'Test school' })
  })

  it('identifies authentication redirect loops without logging credentials', async () => {
    const cx = new Cx({ ...user })
    vi.spyOn(cx.http, 'get').mockRejectedValueOnce(upstreamError('ERR_TOO_MANY_REDIRECTS'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const error = await cx.login().catch(error => error)
    expect(error).toBeInstanceOf(CxLoginError)
    expect(error).toMatchObject({ stage: '认证', code: 'ERR_TOO_MANY_REDIRECTS' })
    expect(error.message).toContain('认证发生循环重定向')
    expect(JSON.stringify(warn.mock.calls)).not.toContain(user.password)
    expect(error.message).not.toContain(user.password)
    expect(cx.user.logged).toBe(false)
  })

  it('identifies profile redirect loops and does not mark the account logged in', async () => {
    const cx = new Cx({ ...user })
    vi.spyOn(cx.http, 'get')
      .mockResolvedValueOnce(authenticated as never)
      .mockRejectedValueOnce(upstreamError('ERR_TOO_MANY_REDIRECTS'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(cx.login()).rejects.toMatchObject({ stage: '读取资料', code: 'ERR_TOO_MANY_REDIRECTS' })
    expect(cx.user.logged).toBe(false)
  })

  it('preserves credential rejection and clears a previous login state', async () => {
    const cx = new Cx({ ...user, logged: true })
    const get = vi.spyOn(cx.http, 'get').mockResolvedValueOnce({ body: { result: false, errorMsg: '账号或密码错误' } } as never)

    await expect(cx.login()).resolves.toBe('账号或密码错误')
    expect(get).toHaveBeenCalledTimes(1)
    expect(cx.user.logged).toBe(false)
  })

  it('bounds network requests and reports timeouts', async () => {
    const cx = new Cx({ ...user })
    const get = vi.spyOn(cx.http, 'get').mockRejectedValueOnce(upstreamError('ETIMEDOUT'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(cx.login()).rejects.toMatchObject({ code: 'ETIMEDOUT', message: '学习通认证请求超时，请稍后重试' })
    expect(get.mock.calls[0][1]).toMatchObject({ timeout: { request: 15000 }, retry: { limit: 0 } })
  })

  it('does not send invalid account formats upstream', async () => {
    const cx = new Cx({ ...user, username: 'invalid' })
    const get = vi.spyOn(cx.http, 'get')
    await expect(cx.login()).resolves.toBe('账号密码格式不正确')
    expect(get).not.toHaveBeenCalled()
  })

  it('does not expose arbitrary upstream error codes', async () => {
    const cx = new Cx({ ...user })
    vi.spyOn(cx.http, 'get').mockRejectedValueOnce(upstreamError(`pwd=${user.password}`))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(cx.login()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain(user.password)
  })
})
