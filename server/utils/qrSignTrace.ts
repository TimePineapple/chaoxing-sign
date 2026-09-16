import type { H3Event } from 'h3'

export function isQrSignRequest(event: H3Event): boolean {
  return event.node.req.url?.split('?')[0].replace(/\/$/, '').endsWith('/sign_by_qrcode') === true
}

export function getQrSignTraceId(event: H3Event): string {
  const context = event.context as typeof event.context & { qrSignTraceId?: string }
  if (context.qrSignTraceId)
    return context.qrSignTraceId

  const testHeader = (event as H3Event & { headers?: Record<string, string> }).headers?.['x-qr-sign-trace-id']
  const header = event.node?.req?.headers?.['x-qr-sign-trace-id'] ?? testHeader
  const supplied = typeof header === 'string' && /^qr-[a-z0-9-]{6,64}$/.test(header) ? header : null
  context.qrSignTraceId = supplied || `qr-server-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return context.qrSignTraceId
}
