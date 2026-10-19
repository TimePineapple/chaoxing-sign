import { getServerSession } from '#auth'
import { CxLoginError } from '~/server/protocol/cx'
import { CxProxyError } from '~/server/protocol/cx/proxy'
import { renewCxAccount } from '~/server/utils/cxSession'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.uid)
    throw createError({ statusCode: 401, message: '网站登录已过期，请重新登录' })
  const body = await readBody<{ uid: string; mode: 'manual' | 'saved'; password?: string }>(event)
  const uid = String(event.context.params?.uid || '')
  if (!uid || body?.uid !== uid || !['manual', 'saved'].includes(body.mode)
    || (body.mode === 'manual' && (typeof body.password !== 'string' || !body.password)))
    throw createError({ statusCode: 400, message: '重新登录请求无效' })
  try {
    return ResOp.success(await renewCxAccount(event.context.prisma, session.uid, uid,
      body.mode === 'manual' ? body.password : undefined), '重新登录成功')
  }
  catch (error) {
    if (error instanceof CxLoginError || error instanceof CxProxyError)
      throw createError({ statusCode: 502, message: error.message })
    throw error
  }
})
