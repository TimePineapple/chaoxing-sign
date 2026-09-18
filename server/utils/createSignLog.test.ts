import { expect, it, vi } from 'vitest'
import { createSignLog } from './createSignLog'
import { recentSignBus } from './recentSignBus'

it('queries Chaoxing once after success, saves the course name, and pushes to all owner clients', async () => {
  const getCourseList = vi.fn().mockResolvedValue([{ courseId: 'course-1', classId: 'class-1', name: '实时课程名' }])
  const cx = { user: { uid: 'cx-a' }, courseList: [], getCourseList }
  const create = vi.fn().mockResolvedValue({ id: 'log-a' })
  const update = vi.fn().mockResolvedValue({})
  const findUnique = vi.fn().mockResolvedValue({ userId: 'web-a' })
  const prisma = { signLog: { create, update }, cxAccount: { findUnique } }
  const first = vi.fn()
  const second = vi.fn()
  const otherOwner = vi.fn()
  const onCourseNameResolved = vi.fn()
  const closeFirst = recentSignBus.subscribe('web-a', first)
  const closeSecond = recentSignBus.subscribe('web-a', second)
  const closeOther = recentSignBus.subscribe('web-b', otherOwner)
  try {
    await createSignLog(cx as any, prisma as any, {
      activityId: '10', activityName: '签到', courseId: 'course-1', classId: 'class-1',
      courseName: '旧课程名', type: 0, mode: 1, result: '签到成功',
    }, onCourseNameResolved)
    await vi.waitFor(() => expect(first).toHaveBeenCalledOnce())
    expect(onCourseNameResolved).toHaveBeenCalledWith('实时课程名')
    expect(getCourseList).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith({ where: { id: 'log-a' }, data: { courseName: '实时课程名' } })
    expect(second).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'cx-a', sign: expect.objectContaining({ name: '实时课程名' }),
    }))
    expect(otherOwner).not.toHaveBeenCalled()
  }
  finally {
    closeFirst()
    closeSecond()
    closeOther()
  }
})

it('does not query or broadcast failed sign attempts', async () => {
  const getCourseList = vi.fn()
  const create = vi.fn().mockResolvedValue({ id: 'log-b' })
  await createSignLog({ user: { uid: 'cx-a' }, getCourseList } as any,
    { signLog: { create } } as any,
    { activityId: '11', activityName: '签到', type: 0, mode: 1, result: '失败' })
  expect(create).toHaveBeenCalledOnce()
  expect(getCourseList).not.toHaveBeenCalled()
})

it('pushes a known course name when the live course lookup fails', async () => {
  const getCourseList = vi.fn().mockRejectedValue(new Error('upstream unavailable'))
  const onSign = vi.fn()
  const close = recentSignBus.subscribe('web-a', onSign)
  try {
    await createSignLog({ user: { uid: 'cx-a' }, courseList: [], getCourseList } as any, {
      signLog: { create: vi.fn().mockResolvedValue({ id: 'log-c' }) },
      course: { findFirst: vi.fn().mockResolvedValue(null) },
      cxAccount: { findUnique: vi.fn().mockResolvedValue({ userId: 'web-a' }) },
    } as any, {
      activityId: '12', activityName: '普通签到', courseId: 'course-1',
      courseName: '已知课程', type: 0, mode: 2, result: '签到成功',
    })
    await vi.waitFor(() => expect(onSign).toHaveBeenCalledOnce())
    expect(getCourseList).toHaveBeenCalledOnce()
    expect(onSign.mock.calls[0][0].sign.name).toBe('已知课程')
  }
  finally {
    close()
  }
})
