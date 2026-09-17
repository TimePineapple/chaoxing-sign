// The QR endpoint acknowledges a job; upstream work and sign-log creation happen later.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResOp } from '../server/utils'
import { getQrSignTraceId, isQrSignRequest } from '../server/utils/qrSignTrace'

const signLink = 'https://mobilelearn.chaoxing.com/widget/sign/e?id=100&c=200&enc=FIXTURE'
const activity = { id: 100, courseId: 'course-1', clazzId: 300, activeType: 2, status: 1, otherId: 2, name: 'Fixture sign' }
let handler: any
let queue: typeof import('../server/utils/qrSignQueue').qrSignQueue

function fixture(uid: string, ownerId = 'web-a') {
  const cx = {
    user: { uid }, courseList: [],
    getActivityDetail: vi.fn().mockResolvedValue(activity),
    getCourseList: vi.fn().mockResolvedValue([]),
    preSign: vi.fn().mockResolvedValue(undefined),
    signQrCode: vi.fn().mockResolvedValue('签到成功'),
  }
  const prisma = {
    cxAccount: {
      findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.userId === ownerId ? { uid } : null)),
      findUnique: vi.fn().mockResolvedValue({ userId: ownerId }),
    },
    course: { findFirst: vi.fn().mockResolvedValue(null) },
    signLog: { create: vi.fn().mockResolvedValue({ id: 'saved-sign-log' }), update: vi.fn().mockResolvedValue({}) },
  }
  const event = {
    session: { uid: ownerId },
    body: { uid, url: signLink, activityId: '100', code: '200', enc: 'FIXTURE' },
    context: { params: { uid }, cx, prisma },
    headers: { 'x-qr-sign-trace-id': 'qr-fixture-123456' },
  }
  return { cx, prisma, event }
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('readBody', (event: any) => Promise.resolve(event.body))
  vi.stubGlobal('getHeader', (event: any, name: string) => event.headers?.[name])
  vi.stubGlobal('setHeader', vi.fn())
  vi.stubGlobal('createError', ({ statusCode, message }: { statusCode: number; message: string }) => Object.assign(new Error(message), { statusCode }))
  vi.stubGlobal('ResOp', ResOp)
  handler = (await import('../server/api/cx/accounts/[uid]/sign_by_qrcode.post')).default
  queue = (await import('../server/utils/qrSignQueue')).qrSignQueue
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('QR submission endpoint', () => {
  it('acknowledges immediately and publishes the eventual result with one upstream submission and log', async () => {
    const { cx, prisma, event } = fixture('cx-a')
    cx.getCourseList.mockResolvedValue([{ name: '示例课程', courseId: 'course-1', classId: '300' }])
    const received: string[] = []
    queue.subscribe('web-a', job => received.push(job.state))
    const response = await handler(event)
    expect(response).toMatchObject({ code: 200, data: { state: 'accepted', job: { state: 'queued', uid: 'cx-a' } } })
    expect(cx.getActivityDetail).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(received).toEqual(['queued', 'running', 'success'])
    expect(cx.signQrCode).toHaveBeenCalledTimes(1)
    expect(prisma.signLog.create).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(prisma.signLog.update).toHaveBeenCalledWith({
      where: { id: 'saved-sign-log' }, data: { courseName: '示例课程' },
    }))
    expect(cx.getCourseList).toHaveBeenCalledTimes(1)
    expect(queue.replay('web-a', 0).at(-1)).toMatchObject({ state: 'success', result: '签到成功' })
  })

  it('rejects a second URL for the same account even while the first job is still queued', async () => {
    const { cx, prisma, event } = fixture('cx-a')
    const first = await handler(event)
    event.body = { ...event.body, url: signLink.replace('id=100', 'id=101'), activityId: '101' }
    const second = await handler(event)
    expect(second).toMatchObject({ code: 200, data: { state: 'busy', job: { id: first.data.job.id, activityId: '100' } } })
    expect(cx.getActivityDetail).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(cx.signQrCode).toHaveBeenCalledTimes(1)
    expect(prisma.signLog.create).toHaveBeenCalledTimes(1)
  })

  it('uses one global 200ms interval across distinct website owners', async () => {
    const a = fixture('cx-a', 'web-a')
    const b = fixture('cx-b', 'web-b')
    const started: number[] = []
    a.cx.getActivityDetail.mockImplementation(async () => { started.push(Date.now()); return activity })
    b.cx.getActivityDetail.mockImplementation(async () => { started.push(Date.now()); return activity })
    await handler(a.event)
    await handler(b.event)
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(started[1] - started[0]).toBe(200)
    expect(a.prisma.signLog.create).toHaveBeenCalledTimes(1)
    expect(b.prisma.signLog.create).toHaveBeenCalledTimes(1)
  })

  it('checks website ownership before queueing and never exposes other owners in event snapshots', async () => {
    const a = fixture('cx-a', 'web-a')
    const b = fixture('cx-b', 'web-b')
    await handler(a.event)
    expect(queue.snapshot('web-b').active).toEqual([])
    b.event.context.prisma.cxAccount.findFirst.mockResolvedValueOnce(null)
    await expect(handler(b.event)).rejects.toMatchObject({ statusCode: 404 })
    expect(b.cx.getActivityDetail).not.toHaveBeenCalled()
    expect(queue.snapshot('web-b').active).toEqual([])
  })

  it('rejects forged QR fields and preserves sanitized trace IDs', async () => {
    const { event } = fixture('cx-a')
    event.body.enc = 'wrong'
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 })
    const traceEvent = {
      node: { req: { url: '/api/cx/accounts/cx-a/sign_by_qrcode', headers: { 'x-qr-sign-trace-id': 'qr-fixture-123456' } } },
      context: {},
    } as any
    expect(isQrSignRequest(traceEvent)).toBe(true)
    expect(getQrSignTraceId(traceEvent)).toBe('qr-fixture-123456')
  })
})
