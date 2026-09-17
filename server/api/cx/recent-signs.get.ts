import { getServerSession } from '#auth'
import { getRecentSigns } from '~/server/utils/recentSigns'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.uid)
    throw createError({ statusCode: 401, message: '网站登录已过期，请重新登录' })

  setHeader(event, 'Cache-Control', 'no-store')
  return ResOp.success(await getRecentSigns(event.context.prisma, session.uid))
})
