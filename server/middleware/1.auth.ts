import { getServerSession } from '#auth'
import { getQrSignTraceId, isQrSignRequest } from '~/server/utils/qrSignTrace'

export default eventHandler(async (event) => {
  const { context, node: { req } } = event

  // 只有 /api/cx 下文件夹需要身份效验
  if (!req.url?.startsWith('/api/cx'))
    return

  const traceId = isQrSignRequest(event) ? getQrSignTraceId(event) : null
  if (traceId)
    console.info(`[qr-code-sign][${traceId}] auth start`)
  try {
    const session = await getServerSession(event)
    if (!session) {
      if (traceId)
        console.warn(`[qr-code-sign][${traceId}] auth rejected`, { status: 401 })
      throw createError({ statusCode: 401, message: '登录已过期,请重新登录' })
    }
    if (traceId)
      console.info(`[qr-code-sign][${traceId}] auth complete`)
  }
  catch (error) {
    if (traceId) {
      const failure = error as { statusCode?: number; code?: string }
      console.error(`[qr-code-sign][${traceId}] auth failed`, { status: failure?.statusCode, code: failure?.code })
    }
    throw error
  }
})
