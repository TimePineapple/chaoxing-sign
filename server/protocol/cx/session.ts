import * as cheerio from 'cheerio'
import { Options, RequestError } from 'got'

export const CX_SESSION_EXPIRED = 'CX_SESSION_EXPIRED'
export const CX_SESSION_MESSAGE = '登陆状态失效，请重新登录'

export class CxSessionExpiredError extends RequestError {
  readonly statusCode = 409
  override readonly code = CX_SESSION_EXPIRED
  readonly publicMessage = CX_SESSION_MESSAGE
  readonly data: { code: string; uid: string; lastLoginTime?: string }
  constructor(public readonly uid: string, lastLoginTime?: string) {
    // A fresh Options object prevents got from retaining upstream URLs or cookies.
    super(CX_SESSION_MESSAGE, { code: CX_SESSION_EXPIRED }, new Options())
    this.name = 'CxSessionExpiredError'
    this.data = { code: this.code, uid, lastLoginTime }
  }
}

export function isCxLoginUrl(value: string | URL | undefined): boolean {
  if (!value)
    return false
  try {
    const url = new URL(value)
    return /^passport2(?:-[a-z0-9]+)?\.chaoxing\.com$/i.test(url.hostname)
      && /^\/(?:login|fanyalogin|mlogin)(?:\/|$)/i.test(url.pathname)
  }
  catch { return false }
}

export function isCxLoginHtml(body: unknown): boolean {
  if (typeof body !== 'string' || !/<(?:html|form|input)\b/i.test(body))
    return false
  const $ = cheerio.load(body)
  return $('form').toArray().some((form) => {
    const node = $(form)
    const action = node.attr('action') || ''
    return node.find('input[type="password"]').length > 0
      && (isCxLoginUrl(action.startsWith('/') ? `https://passport2.chaoxing.com${action}` : action)
        || (node.find('input[name="uname"], input[name="username"], input#phone').length > 0
          && /(?:学习通|超星|chaoxing)/i.test(body)))
  })
}
