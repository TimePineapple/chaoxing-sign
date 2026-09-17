import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResOp } from '../server/utils'

beforeEach(() => {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('readBody', (event: any) => Promise.resolve(event.body))
  vi.stubGlobal('ResOp', ResOp)
})

describe('sign log course names', () => {
  it('writes valid records for each result of a course sign', async () => {
    const handler = (await import('../server/api/cx/courses/[cid]/sign.post')).default
    const create = vi.fn().mockResolvedValue({})
    const event = {
      body: { uid: 'cx-a', course: { name: '高等数学', courseId: 'course-1' } },
      context: {
        cx: { user: { uid: 'cx-a' }, signByCourse: vi.fn().mockResolvedValue([
          { activity: { id: 10, name: '普通签到', otherId: 0 }, result: '签到成功' },
          { activity: { id: 11, name: '失败签到', otherId: 2 }, result: '失败' },
        ]) },
        prisma: { signLog: { create }, cxAccount: { findUnique: vi.fn().mockResolvedValue(null) } },
      },
    } as any
    await handler(event)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      accountId: 'cx-a', activityName: '普通签到', courseName: '高等数学', result: '签到成功',
    }))
    expect(create.mock.calls[1][0].data).toEqual(expect.objectContaining({
      accountId: 'cx-a', activityName: '失败签到', courseName: '高等数学', result: '失败',
    }))
    expect(create.mock.calls[0][0].data).not.toHaveProperty('isSigned')
  })

  it('records a single activity sign with its course name', async () => {
    const handler = (await import('../server/api/cx/courses/[cid]/activities/[aid]/sign.post')).default
    const create = vi.fn().mockResolvedValue({})
    await handler({
      body: { uid: 'cx-a', course: { name: '线性代数' }, activity: { id: 21 } },
      context: {
        cx: { user: { uid: 'cx-a' }, signByActivity: vi.fn().mockResolvedValue({ activity: { id: 21, name: '签到', otherId: 0 }, result: '签到成功' }) },
        prisma: { signLog: { create }, cxAccount: { findUnique: vi.fn().mockResolvedValue(null) } },
      },
    } as any)
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ courseName: '线性代数', result: '签到成功' }) })
  })

  it.each(['code', 'gesture'])('resolves a course name for %s signs', async (kind) => {
    const handler = kind === 'code'
      ? (await import('../server/api/cx/accounts/[uid]/sign_by_code.post')).default
      : (await import('../server/api/cx/accounts/[uid]/sign_by_gesture.post')).default
    const create = vi.fn().mockResolvedValue({})
    const cx = {
      user: { uid: 'cx-a' },
      courseList: [{ courseId: 'course-1', classId: 'class-1', name: '大学英语' }],
      getActivityDetail: vi.fn().mockResolvedValue({ id: 30, name: '签到', otherId: 5, activeType: 2, status: 1, courseId: 'course-1', clazzId: 'class-1' }),
      preSign: vi.fn().mockResolvedValue(undefined),
      signCode: vi.fn().mockResolvedValue('签到成功'),
      signGesture: vi.fn().mockResolvedValue('签到成功'),
    }
    await handler({
      body: { uid: 'cx-a', courseId: 'course-1', activityId: 30, signCode: 'answer' },
      context: { cx, prisma: { signLog: { create }, cxAccount: { findUnique: vi.fn().mockResolvedValue(null) } } },
    } as any)
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ courseName: null, result: '签到成功' }) })
  })

  it('uses the known course on one-click signs', async () => {
    const handler = (await import('../server/api/cx/accounts/[uid]/sign_all.post')).default
    const create = vi.fn().mockResolvedValue({})
    await handler({
      body: { uid: 'cx-a', setting: {} },
      context: {
        cx: { user: { uid: 'cx-a' }, oneClickSign: vi.fn().mockResolvedValue([{ activity: { id: 40, name: '签到', otherId: 0, course: { name: '物理' } }, result: '签到成功' }]) },
        prisma: { signLog: { create }, cxAccount: { findUnique: vi.fn().mockResolvedValue(null) } },
      },
    } as any)
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ courseName: '物理', result: '签到成功' }) })
  })
})
