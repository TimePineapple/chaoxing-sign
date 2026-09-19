import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QrSignQueue } from './qrSignQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('server-wide QR queue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('claims a UID while queued and starts unrelated jobs at the sampled interval without awaiting results', async () => {
    const queue = new QrSignQueue(75)
    const first = deferred<{ result: string }>()
    const second = deferred<{ result: string }>()
    const starts: number[] = []
    const a = queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '1', run: () => {
      starts.push(Date.now())
      return first.promise
    } })
    const b = queue.submit({ ownerId: 'web-b', uid: 'cx-b', activityId: '1', run: () => {
      starts.push(Date.now())
      return second.promise
    } })
    const duplicate = vi.fn()
    const busy = queue.submit({ ownerId: 'web-a', uid: 'cx-b', activityId: '2', run: duplicate })
    expect(a.state).toBe('accepted')
    expect(b.state).toBe('accepted')
    expect(busy).toMatchObject({ state: 'busy', job: { id: b.job.id, activityId: '1' } })
    expect(duplicate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(74)
    expect(starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(starts[1] - starts[0]).toBe(75)
    expect(queue.snapshot('web-a').active).toHaveLength(1)
    expect(queue.snapshot('web-b').active).toHaveLength(1)
    first.resolve({ result: '签到成功' })
    second.resolve({ result: '签到成功' })
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.snapshot('web-a').active).toEqual([])
    expect(queue.snapshot('web-b').active).toEqual([])
    expect(queue.replay('web-a', 0).at(-1)?.state).toBe('success')
    expect(queue.replay('web-b', 0).at(-1)?.state).toBe('success')
  })

  it('broadcasts only to the owner and accepts a new same-activity submission immediately after success', async () => {
    const queue = new QrSignQueue()
    const eventsA: string[] = []
    const eventsB: string[] = []
    queue.subscribe('web-a', event => eventsA.push(event.state))
    queue.subscribe('web-b', event => eventsB.push(event.state))
    const run = vi.fn().mockResolvedValue({ result: '签到成功' })
    const accepted = queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', run })
    await vi.advanceTimersByTimeAsync(0)
    expect(eventsA).toEqual(['queued', 'running', 'success'])
    expect(eventsB).toEqual([])
    expect(queue.replay('web-a', 0).map(event => event.state)).toEqual(eventsA)
    expect(queue.replay('web-b', 0)).toEqual([])
    const again = queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', run })
    expect(again).toMatchObject({ state: 'accepted' })
    expect(again.job.id).not.toBe(accepted.job.id)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('accepts a new same-activity submission immediately after failure', async () => {
    const queue = new QrSignQueue()
    const run = vi.fn().mockResolvedValue({ result: '签到已过期' })
    queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', run })
    await vi.advanceTimersByTimeAsync(0)
    const again = queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', run })
    expect(again.state).toBe('accepted')
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('shares active jobs and recent successes only with their owner, then expires success after one minute', async () => {
    const queue = new QrSignQueue()
    const pending = deferred<{ result: string; courseName: string }>()
    const decision = queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', clientId: 'client-a',
      run: () => pending.promise })
    expect(queue.snapshot('web-a').active).toMatchObject([{
      id: decision.job.id, clientId: 'client-a', state: 'queued', submittedAt: Date.now(),
    }])
    expect(queue.snapshot('web-b')).toEqual({ active: [], recentSuccess: [] })

    await vi.advanceTimersByTimeAsync(0)
    pending.resolve({ result: '签到成功', courseName: '高等数学' })
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.snapshot('web-a').recentSuccess).toMatchObject([{
      id: decision.job.id, state: 'success', clientId: 'client-a',
      completedAt: Date.now(), courseName: '高等数学',
    }])
    expect(queue.snapshot('web-b').recentSuccess).toEqual([])
    await vi.advanceTimersByTimeAsync(59_999)
    expect(queue.snapshot('web-a').recentSuccess).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(queue.snapshot('web-a').recentSuccess).toEqual([])
  })

  it('publishes a resolved course name after success without extending the one-minute window', async () => {
    const queue = new QrSignQueue()
    let reportCourseName!: (name: string) => void
    const events: string[] = []
    queue.subscribe('web-a', event => events.push(`${event.state}:${event.courseName || ''}`))
    queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', run: async (_signal, report) => {
      reportCourseName = report
      return { result: '签到成功' }
    } })
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.snapshot('web-a').recentSuccess[0].courseName).toBeUndefined()
    await vi.advanceTimersByTimeAsync(30_000)
    reportCourseName('实时课程名')
    expect(events.at(-1)).toBe('success:实时课程名')
    expect(queue.snapshot('web-a').recentSuccess[0].courseName).toBe('实时课程名')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(queue.snapshot('web-a').recentSuccess).toEqual([])
    reportCourseName('过期更新')
    expect(events.at(-1)).toBe('success:实时课程名')
  })

  it('does not restore failed jobs in a newly opened modal', async () => {
    const queue = new QrSignQueue()
    queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', run: async () => ({ result: '签到已过期' }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.snapshot('web-a')).toEqual({ active: [], recentSuccess: [] })
  })

  it('does not include links or QR tokens in client events', async () => {
    const queue = new QrSignQueue()
    const received: string[] = []
    queue.subscribe('web-a', event => received.push(JSON.stringify(event)))
    queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', run: async () => ({
      result: '失败 https://example.test/sign?id=10&enc=PRIVATE cookie=PRIVATE password=PRIVATE',
      activityName: 'https://example.test/private',
      courseName: 'https://example.test/course',
    }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(received.join(' ')).not.toContain('example.test')
    expect(received.join(' ')).not.toContain('PRIVATE')
    expect(received.join(' ')).toContain('链接已隐藏')
  })

  it('times out 45 seconds after execution starts, aborts, publishes uncertainty and releases UID', async () => {
    const queue = new QrSignQueue(75, 45_000)
    const signals: AbortSignal[] = []
    const run = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<{ result: string }>(() => {})
    })
    queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', run })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(44_999)
    expect(queue.snapshot('web-a').active).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(signals[0].aborted).toBe(true)
    expect(queue.snapshot('web-a').active).toHaveLength(0)
    expect(queue.replay('web-a', 0).at(-1)).toMatchObject({ state: 'error', message: expect.stringContaining('结果尚未确认') })
    expect(queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '11', run }).state).toBe('accepted')
  })
})
