import { describe, expect, it, vi } from 'vitest'
import { getRecentSigns } from './recentSigns'

describe('recent sign account summary', () => {
  const now = new Date('2026-09-17T12:00:00.000Z')

  it('queries only this user, successful logs inside 30 minutes, newest first', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { uid: 'cx-a', signlogs: [{ courseName: ' 高等数学 ', activityName: '普通签到', time: new Date('2026-09-17T11:59:59.000Z') }] },
      { uid: 'cx-b', signlogs: [{ courseName: null, activityName: '课堂签到', time: new Date('2026-09-17T11:50:00.000Z') }] },
      { uid: 'cx-c', signlogs: [] },
    ])
    const result = await getRecentSigns({ cxAccount: { findMany } } as any, 'web-a', now)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'web-a' },
      select: expect.objectContaining({
        signlogs: expect.objectContaining({
          where: { result: '签到成功', time: {
            gt: new Date('2026-09-17T11:30:00.000Z'), lte: now,
          } },
          orderBy: [{ time: 'desc' }, { id: 'desc' }],
          take: 1,
        }),
      }),
    }))
    expect(result).toEqual({
      'cx-a': { name: '高等数学', time: '2026-09-17T11:59:59.000Z' },
      'cx-b': { name: '课堂签到', time: '2026-09-17T11:50:00.000Z' },
    })
  })

  it('falls back to a neutral name when legacy activity text is empty', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { uid: 'cx-a', signlogs: [{ courseName: null, activityName: '', time: now }] },
    ])
    expect(await getRecentSigns({ cxAccount: { findMany } } as any, 'web-a', now))
      .toEqual({ 'cx-a': { name: '未知课程', time: now.toISOString() } })
  })
})
