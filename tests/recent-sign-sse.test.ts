import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('h3', () => ({
  createEventStream: () => {
    const messages: Array<{ event: string; data: string }> = []
    let onClosed: (() => void) | undefined
    return {
      push: async (message: { event: string; data: string }) => { messages.push(message) },
      onClosed: (callback: () => void) => { onClosed = callback },
      send: () => ({ messages, close: () => onClosed?.() }),
    }
  },
}))

beforeEach(() => {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setHeader', vi.fn())
  vi.stubGlobal('createError', ({ statusCode, message }: { statusCode: number; message: string }) => Object.assign(new Error(message), { statusCode }))
})

afterEach(() => vi.unstubAllGlobals())

it('rejects unauthenticated subscribers and broadcasts to every client of the owner', async () => {
  const handler = (await import('../server/api/cx/recent-sign-events.get')).default
  const { recentSignBus } = await import('../server/utils/recentSignBus')
  await expect(handler({ session: null } as any)).rejects.toMatchObject({ statusCode: 401 })
  const a1 = await handler({ session: { uid: 'web-a' } } as any) as any
  const a2 = await handler({ session: { uid: 'web-a' } } as any) as any
  const b = await handler({ session: { uid: 'web-b' } } as any) as any
  try {
    const event = { uid: 'cx-a', sign: { name: '高等数学', time: '2026-09-17T00:00:00.000Z' } }
    recentSignBus.publish('web-a', event)
    await vi.waitFor(() => expect(a2.messages).toHaveLength(1))
    expect(a1.messages.map((message: any) => JSON.parse(message.data))).toEqual([event])
    expect(a2.messages.map((message: any) => JSON.parse(message.data))).toEqual([event])
    expect(b.messages).toEqual([])
  }
  finally {
    a1.close()
    a2.close()
    b.close()
  }
})
