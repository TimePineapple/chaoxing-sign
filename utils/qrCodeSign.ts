export interface QrCodeSignLink {
  link: string
  activityId: string
  code: string
  enc: string
}

export function createQrSignTraceId(): string {
  return `qr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export type QrCodeSubmissionResult =
  | { status: 'accepted'; value: QrCodeSignLink }
  | { status: 'invalid' }
  | { status: 'locked' }

export function qrCodeRequestError(error: unknown): string {
  const failure = error as { data?: { message?: string }; statusCode?: number; status?: number; name?: string; cause?: { name?: string } }
  if (failure?.name === 'TimeoutError' || failure?.cause?.name === 'TimeoutError')
    return '等待签到响应超时，结果尚未确认。请先核对签到记录，再决定是否重新扫描'
  if (typeof failure?.data?.message === 'string' && failure.data.message.trim())
    return failure.data.message.trim()

  const status = failure?.statusCode ?? failure?.status
  if (status === 401)
    return '网站登录已过期，请重新登录'
  if (status === 502 || status === 504)
    return `签到响应中断（HTTP ${status}），请先核对签到记录和服务器日志`
  if (status)
    return `签到请求失败（HTTP ${status}）`

  // FetchError messages can contain the complete request URL; do not display them.
  if (error instanceof Error && error.name === 'Error' && error.message.trim())
    return error.message.trim()
  return '签到请求未完成，请检查网络、反向代理和服务端日志'
}

export function parseQrCodeSignLink(value: string): QrCodeSignLink | null {
  const link = value.trim()

  try {
    const url = new URL(link)
    const activityId = url.searchParams.get('id')
    const code = url.searchParams.get('c')
    const enc = url.searchParams.get('enc')

    if (!['http:', 'https:'].includes(url.protocol) || !activityId || !code || !enc)
      return null

    return { link, activityId, code, enc }
  }
  catch {
    return null
  }
}

export function createQrCodeSubmissionGuard() {
  let locked = false

  return {
    reset() {
      locked = false
    },
    tryLock(value: string): QrCodeSubmissionResult {
      if (locked)
        return { status: 'locked' }

      const parsed = parseQrCodeSignLink(value)
      if (!parsed)
        return { status: 'invalid' }

      locked = true
      return { status: 'accepted', value: parsed }
    },
  }
}
