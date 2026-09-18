import type { CookieJar } from 'tough-cookie'

const MAX_PREVIEW_LENGTH = 240
const SAFE_COOKIE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export function qrCookieSnapshot(jar: CookieJar | undefined, url: string): Map<string, string> {
  return new Map(jar?.getCookiesSync(url)
    .filter(cookie => SAFE_COOKIE_NAME.test(cookie.key))
    .map(cookie => [cookie.key, cookie.value]) ?? [])
}

export function qrSetCookieNames(header: string | string[] | undefined): string[] {
  const values = Array.isArray(header) ? header : header ? [header] : []
  return [...new Set(values.map(value => value.split('=', 1)[0]?.trim()).filter((name): name is string => Boolean(name && SAFE_COOKIE_NAME.test(name))))].sort()
}

export function summarizeQrCookieChanges(before: Map<string, string>, after: Map<string, string>) {
  return {
    cookieNamesBefore: [...before.keys()].sort(),
    cookieNamesAfter: [...after.keys()].sort(),
    addedCookieNames: [...after.keys()].filter(name => !before.has(name)).sort(),
    updatedCookieNames: [...after.keys()].filter(name => before.has(name) && before.get(name) !== after.get(name)).sort(),
  }
}

export function summarizeQrUpstreamBody(body: unknown) {
  if (typeof body !== 'string')
    return { bodyType: typeof body }

  const value = body.trim()
  if (!value)
    return { bodyLength: body.length, bodyPreview: '[空响应]' }

  // Upstream may return HTML or a URL containing account and sign parameters.
  if (value.length > MAX_PREVIEW_LENGTH
    || !/^[\p{L}\p{N}\p{Zs}_.，。,:：()（）+\-]+$/u.test(value))
    return { bodyLength: body.length, bodyPreview: '[非简短文本响应已隐藏]' }

  return {
    bodyLength: body.length,
    bodyPreview: value
      .replace(/-?\d{1,3}\.\d{4,}/g, '[坐标已隐藏]')
      .replace(/\b\d{7,}\b/g, '[数字已隐藏]'),
  }
}

export function safeQrContentType(value: unknown): string | undefined {
  const contentType = Array.isArray(value) ? value[0] : value
  return typeof contentType === 'string' && /^[\w./;=+ -]{1,100}$/.test(contentType)
    ? contentType
    : undefined
}
