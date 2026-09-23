// The QR endpoint acknowledges a job; upstream work and sign-log creation happen later.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResOp } from '../server/utils'
import { getQrSignTraceId, isQrSignRequest } from '../server/utils/qrSignTrace'
import { browserLocationToBaidu, offsetQrLocation } from '../server/utils/qrLocation'

const signLink = 'https://mobilelearn.chaoxing.com/widget/sign/e?id=100&c=200&enc=FIXTURE'
const activity = { id: 100, courseId: 'course-1', clazzId: 300, activeType: 2, status: 1, otherId: 2, name: 'Fixture sign' }
let handler: any
let queue: typeof import('../server/utils/qrSignQueue').qrSignQueue

function fixture(uid: string, ownerId = 'web-a') {
  const cx = {
    user: { uid }, courseList: [],
    getActivityDetail: vi.fn().mockResolvedValue(activity),
    getQrSignLocationRequirement: vi.fn().mockResolvedValue(true),
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
    qrCourseSlotCache: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
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
  vi.stubEnv('BAIDU_MAP_SERVER_AK', 'fixture-map-ak')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 0, result: { formatted_address: '北京市东城区某路' } }),
  }))
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
  vi.unstubAllEnvs()
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
    expect(cx.signQrCode.mock.calls[0][2]).toBe('course-1')
    expect(cx.signQrCode.mock.calls[0][5]).toBe('qr-fixture-123456')
    expect(prisma.signLog.create).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(prisma.signLog.update).toHaveBeenCalledWith({
      where: { id: 'saved-sign-log' }, data: { courseName: '示例课程' },
    }))
    expect(cx.getCourseList).toHaveBeenCalledTimes(1)
    expect(prisma.qrCourseSlotCache.findUnique).not.toHaveBeenCalled()
    expect(queue.replay('web-a', 0).at(-1)).toMatchObject({ state: 'success', result: '签到成功' })
  })

  it('uses a matching weekly slot cache without requesting the live course list', async () => {
    const { cx, prisma, event } = fixture('cx-a')
    cx.getActivityDetail.mockResolvedValue({ ...activity, courseId: '', clazzId: 300 })
    prisma.qrCourseSlotCache.findUnique.mockResolvedValue({ courseId: 'cached-course', courseName: '缓存课程' })

    await handler(event)
    await vi.advanceTimersByTimeAsync(0)

    expect(prisma.qrCourseSlotCache.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { accountId_weekday_slotStartMinute_classId: {
        accountId: 'cx-a', weekday: 4, slotStartMinute: 450, classId: '300',
      } },
    }))
    expect(cx.getCourseList).not.toHaveBeenCalled()
    expect(cx.signQrCode.mock.calls[0][2]).toBe('cached-course')
    expect(prisma.signLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ courseName: '缓存课程' }),
    })
  })

  it('queries live on a slot miss, caches the match, and avoids a second name lookup', async () => {
    const { cx, prisma, event } = fixture('cx-a')
    cx.getActivityDetail.mockResolvedValue({ ...activity, courseId: '', clazzId: 300 })
    cx.getCourseList.mockResolvedValue([{ name: '实时课程', courseId: 'live-course', classId: '300' }])

    await handler(event)
    await vi.advanceTimersByTimeAsync(0)

    expect(cx.getCourseList).toHaveBeenCalledTimes(1)
    expect(prisma.qrCourseSlotCache.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { courseId: 'live-course', courseName: '实时课程' },
    }))
    expect(cx.signQrCode.mock.calls[0][2]).toBe('live-course')
  })

  it('refreshes a cache entry that conflicts with the request course id', async () => {
    const { cx, prisma, event } = fixture('cx-a')
    event.body.courseId = 'live-course'
    cx.getActivityDetail.mockResolvedValue({ ...activity, courseId: '', clazzId: 300 })
    prisma.qrCourseSlotCache.findUnique.mockResolvedValue({ courseId: 'stale-course', courseName: '旧课程' })
    cx.getCourseList.mockResolvedValue([{ name: '新课程', courseId: 'live-course', classId: '300' }])

    await handler(event)
    await vi.advanceTimersByTimeAsync(0)

    expect(cx.getCourseList).toHaveBeenCalledTimes(1)
    expect(prisma.qrCourseSlotCache.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { courseId: 'live-course', courseName: '新课程' },
    }))
    expect(cx.signQrCode.mock.calls[0][2]).toBe('live-course')
  })

  it('continues through live lookup when slot cache reads and writes fail', async () => {
    const { cx, prisma, event } = fixture('cx-a')
    cx.getActivityDetail.mockResolvedValue({ ...activity, courseId: '', clazzId: 300 })
    prisma.qrCourseSlotCache.findUnique.mockRejectedValue(new Error('cache unavailable'))
    prisma.qrCourseSlotCache.upsert.mockRejectedValue(new Error('cache unavailable'))
    cx.getCourseList.mockResolvedValue([{ name: '实时课程', courseId: 'live-course', classId: '300' }])
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await handler(event)
    await vi.advanceTimersByTimeAsync(0)

    expect(cx.getCourseList).toHaveBeenCalledTimes(1)
    expect(cx.signQrCode.mock.calls[0][2]).toBe('live-course')
    expect(queue.replay('web-a', 0).at(-1)).toMatchObject({ state: 'success' })
  })

  it('keeps the existing course resolution flow outside cache hours', async () => {
    vi.setSystemTime(new Date('2026-01-01T22:00:00.000Z')) // Beijing Friday 06:00
    const { cx, prisma, event } = fixture('cx-a')
    cx.getActivityDetail.mockResolvedValue({ ...activity, courseId: '', clazzId: 300 })
    prisma.course.findFirst.mockResolvedValue({ courseId: 'saved-course' })

    await handler(event)
    await vi.advanceTimersByTimeAsync(0)

    expect(prisma.qrCourseSlotCache.findUnique).not.toHaveBeenCalled()
    expect(prisma.course.findFirst).toHaveBeenCalled()
    expect(cx.signQrCode.mock.calls[0][2]).toBe('saved-course')
  })

  it('does not cache or submit when the live list has no matching class', async () => {
    const { cx, prisma, event } = fixture('cx-a')
    cx.getActivityDetail.mockResolvedValue({ ...activity, courseId: '', clazzId: 300 })
    cx.getCourseList.mockResolvedValue([{ name: '其他课程', courseId: 'other-course', classId: '999' }])
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await handler(event)
    await vi.advanceTimersByTimeAsync(0)

    expect(prisma.qrCourseSlotCache.upsert).not.toHaveBeenCalled()
    expect(cx.signQrCode).not.toHaveBeenCalled()
    expect(queue.replay('web-a', 0).at(-1)).toMatchObject({ state: 'error', message: expect.stringContaining('未能在该账号的课程列表中匹配') })
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

  it('uses one global request interval across distinct website owners', async () => {
    const a = fixture('cx-a', 'web-a')
    const b = fixture('cx-b', 'web-b')
    const started: number[] = []
    a.cx.getActivityDetail.mockImplementation(async () => { started.push(Date.now()); return activity })
    b.cx.getActivityDetail.mockImplementation(async () => { started.push(Date.now()); return activity })
    await handler(a.event)
    await handler(b.event)
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(30)
    expect(started[1] - started[0]).toBeLessThanOrEqual(100)
    expect(a.prisma.signLog.create).toHaveBeenCalledTimes(1)
    expect(b.prisma.signLog.create).toHaveBeenCalledTimes(1)
  })

  it('uses a separate nearby position per account and keeps the missing-location fallback', async () => {
    const a = fixture('cx-a', 'web-a')
    const b = fixture('cx-b', 'web-b')
    a.event.body.location = { latitude: 39.908823, longitude: 116.39747 }
    b.event.body.location = { latitude: 39.908823, longitude: 116.39747 }
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0)
      .mockReturnValueOnce(0.25).mockReturnValueOnce(0.5)
    await handler(a.event)
    await handler(b.event)
    await vi.advanceTimersByTimeAsync(200)
    const aLocation = a.cx.signQrCode.mock.calls[0][4]
    const bLocation = b.cx.signQrCode.mock.calls[0][4]
    const firstRandom = [0.25, 0]
    const expectedBaiduLocation = browserLocationToBaidu(offsetQrLocation(a.event.body.location, () => firstRandom.shift()!))
    expect(aLocation).toMatchObject({ latitude: expect.any(Number), longitude: expect.any(Number), address: '北京市东城区某路' })
    expect(aLocation).toMatchObject(expectedBaiduLocation)
    expect(bLocation).toMatchObject({ latitude: expect.any(Number), longitude: expect.any(Number), address: '北京市东城区某路' })
    expect(aLocation).not.toEqual(bLocation)
    expect(random).toHaveBeenCalledTimes(4)
    expect(fetch).toHaveBeenCalledTimes(1)

    const c = fixture('cx-c', 'web-c')
    await handler(c.event)
    await vi.advanceTimersByTimeAsync(200)
    expect(c.cx.signQrCode.mock.calls[0][4]).toBeUndefined()
  })

  it('omits position parameters when the QR activity does not request a location', async () => {
    const { cx, event } = fixture('cx-a')
    event.body.location = { latitude: 39.908823, longitude: 116.39747 }
    cx.getQrSignLocationRequirement.mockResolvedValue(false)
    await handler(event)
    await vi.advanceTimersByTimeAsync(0)
    expect(cx.getQrSignLocationRequirement).toHaveBeenCalledWith(100, expect.any(AbortSignal))
    expect(cx.signQrCode.mock.calls[0][4]).toBeUndefined()
  })

  it('stops before upstream submission when the map AK is missing', async () => {
    const { cx, event } = fixture('cx-a')
    event.body.location = { latitude: 39.908823, longitude: 116.39747 }
    vi.stubEnv('BAIDU_MAP_SERVER_AK', '')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await handler(event)
    await vi.advanceTimersByTimeAsync(0)

    expect(cx.signQrCode).not.toHaveBeenCalled()
    expect(queue.replay('web-a', 0).at(-1)).toMatchObject({
      state: 'error', message: expect.stringContaining('未配置百度地图服务端 AK'),
    })
    expect(error).toHaveBeenCalledWith(
      '[qr-code-sign][qr-fixture-123456] request failed',
      expect.objectContaining({ code: 'BAIDU_MAP_AK_MISSING' }),
    )
  })

  it('logs the upstream location rejection code without treating its HTTP response as a request failure', async () => {
    const { cx, event } = fixture('cx-a')
    event.body.location = { latitude: 39.908823, longitude: 116.39747 }
    cx.signQrCode.mockResolvedValue('locationAuthError_LCR007')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await handler(event)
    await vi.advanceTimersByTimeAsync(0)

    expect(warning).toHaveBeenCalledWith(
      '[qr-code-sign][qr-fixture-123456] upstream rejected',
      expect.objectContaining({ code: 'locationAuthError_LCR007' }),
    )
    expect(queue.replay('web-a', 0).at(-1)).toMatchObject({
      state: 'error', result: 'locationAuthError_LCR007',
    })
  })

  it('rejects invalid client coordinates before enqueueing', async () => {
    const { event } = fixture('cx-a')
    event.body.location = { latitude: 120, longitude: 116 }
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 })
    expect(queue.snapshot('web-a').active).toEqual([])
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
