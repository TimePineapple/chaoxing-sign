import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('h3', () => ({
  createEventStream: () => {
    const messages: Array<{ id?: string; event: string; data: string }> = []
    let onClosed: (() => void) | undefined
    return {
      push: async (message: { id?: string; event: string; data: string }) => { messages.push(message) },
      onClosed: (callback: () => void) => { onClosed = callback },
      send: () => ({ messages, close: () => onClosed?.() }),
    }
  },
}))

let handler: any
let queue: typeof import('../server/utils/qrSignQueue').qrSignQueue

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('setHeader', vi.fn())
  vi.stubGlobal('getHeader', () => undefined)
  vi.stubGlobal('createError', ({ statusCode, message }: { statusCode: number; message: string }) => Object.assign(new Error(message), { statusCode }))
  handler = (await import('../server/api/cx/qr-events.get')).default
  queue = (await import('../server/utils/qrSignQueue')).qrSignQueue
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('QR event stream', () => {
  it('rejects an unauthenticated subscription', async () => {
    await expect(handler({ session: null })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('delivers events and snapshots only to the website account that owns the task', async () => {
    const a = await handler({ session: { uid: 'web-a' } })
    const b = await handler({ session: { uid: 'web-b' } })
    queue.submit({ ownerId: 'web-a', uid: 'cx-a', activityId: '10', run: async () => ({ result: '签到成功' }) })
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 8; i++)
      await Promise.resolve()
    const aJobs = a.messages.filter((item: any) => item.event === 'job').map((item: any) => JSON.parse(item.data))
    expect(aJobs.map((item: any) => item.state)).toEqual(['queued', 'running', 'success'])
    expect(b.messages.filter((item: any) => item.event === 'job')).toEqual([])
    expect(JSON.parse(b.messages.find((item: any) => item.event === 'snapshot').data)).toEqual({ active: [] })
    a.close()
    b.close()
  })
})
