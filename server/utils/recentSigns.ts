import type { PrismaClient } from '@prisma/client'
import type { RecentSign } from '~/types/recentSign'

export const RECENT_SIGN_WINDOW_MS = 30 * 60 * 1000

export async function getRecentSigns(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<Record<string, RecentSign>> {
  const accounts = await prisma.cxAccount.findMany({
    where: { userId },
    select: {
      uid: true,
      signlogs: {
        where: {
          result: '签到成功',
          time: { gt: new Date(now.getTime() - RECENT_SIGN_WINDOW_MS), lte: now },
        },
        orderBy: [{ time: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { courseName: true, activityName: true, time: true },
      },
    },
  })

  const result: Record<string, RecentSign> = {}
  for (const account of accounts) {
    const log = account.signlogs[0]
    if (log) {
      result[account.uid] = {
        name: log.courseName?.trim() || log.activityName?.trim() || '未知课程',
        time: log.time.toISOString(),
      }
    }
  }
  return result
}
