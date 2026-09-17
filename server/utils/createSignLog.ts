import type { PrismaClient } from '@prisma/client'
import type { Cx } from '~/server/protocol/cx'
import { recentSignBus } from '~/server/utils/recentSignBus'
import { resolveSignCourseName } from '~/server/utils/signLogCourse'

export interface SignLogInput {
  activityId: string
  activityName: string
  type: number
  mode: number
  result: string
  courseId?: string | number | null
  classId?: string | number | null
  courseName?: string | null
}

export async function createSignLog(cx: Cx, prisma: PrismaClient, input: SignLogInput) {
  const time = new Date()
  const savedName = input.courseName?.trim() || null
  const log = await prisma.signLog.create({
    data: {
      activityId: input.activityId,
      activityName: input.activityName,
      courseName: savedName,
      type: input.type,
      mode: input.mode,
      result: input.result,
      time,
      accountId: cx.user.uid,
    },
  })

  if (input.result === '签到成功') {
    void (async () => {
      const courseName = await resolveSignCourseName(cx, prisma, input, savedName)
      if (courseName && courseName !== savedName && log.id) {
        try {
          await prisma.signLog.update({ where: { id: log.id }, data: { courseName } })
        }
        catch {
          // Still notify connected clients with the resolved name.
        }
      }
      const account = await prisma.cxAccount.findUnique({
        where: { uid: cx.user.uid }, select: { userId: true },
      })
      if (account?.userId) {
        recentSignBus.publish(account.userId, {
          uid: cx.user.uid,
          sign: { name: courseName || input.activityName?.trim() || '未知课程', time: time.toISOString() },
        })
      }
    })().catch(() => {
      // The saved sign result remains authoritative if name refresh or push fails.
      console.warn('[recent-sign] course refresh or notification failed')
    })
  }
  return log
}
