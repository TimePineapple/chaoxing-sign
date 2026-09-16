import { getServerSession } from '#auth'
import { executeQrSign, type QrSignInput } from '~/server/utils/executeQrSign'
import { qrSignQueue } from '~/server/utils/qrSignQueue'
import { getQrSignTraceId } from '~/server/utils/qrSignTrace'
import { parseQrCodeSignLink } from '~/utils/qrCodeSign'

interface Body extends QrSignInput {
  url: string
}

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.uid)
    throw createError({ statusCode: 401, message: '网站登录已过期，请重新登录' })

  const body = await readBody<Body>(event)
  const uid = String(event.context.params?.uid ?? '')
  const parsed = parseQrCodeSignLink(body?.url || '')
  if (!uid || body?.uid !== uid || !parsed || parsed.activityId !== body.activityId
    || parsed.code !== body.code || parsed.enc !== body.enc)
    throw createError({ statusCode: 400, message: '二维码请求无效，请重新扫描' })

  // The global Cx cache is not an authorization boundary. Check DB ownership first.
  const ownedAccount = await event.context.prisma.cxAccount.findFirst({
    where: { uid, userId: session.uid }, select: { uid: true },
  })
  if (!ownedAccount || event.context.cx?.user?.uid !== uid)
    throw createError({ statusCode: 404, message: '学习通账号不存在' })

  const traceId = getQrSignTraceId(event)
  const cx = event.context.cx
  const prisma = event.context.prisma
  const input: QrSignInput = {
    uid, activityId: body.activityId, code: body.code, enc: body.enc, courseId: body.courseId,
  }
  setHeader(event, 'Cache-Control', 'no-store')
  return ResOp.success(qrSignQueue.submit({
    ownerId: session.uid, uid, activityId: body.activityId,
    run: signal => executeQrSign(cx, prisma, input, signal, traceId),
  }))
})
