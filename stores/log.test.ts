import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createDiscreteApi, messages } = vi.hoisted(() => ({
  createDiscreteApi: vi.fn(),
  messages: [] as string[],
}))

vi.mock('naive-ui', () => ({ createDiscreteApi }))

beforeEach(() => {
  messages.length = 0
  createDiscreteApi.mockReset()
  vi.stubGlobal('defineStore', (_name: string, setup: () => unknown) => setup)
  vi.stubGlobal('useLocalStorage', () => ({ value: messages }))
  vi.stubGlobal('ref', (value: unknown) => ({ value }))
  vi.stubGlobal('useNow', () => new Date())
  vi.stubGlobal('useDateFormat', () => ({ value: '12:00:00' }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('operation log', () => {
  it('records an account result during SSR without trying to create a browser message', async () => {
    const { useLogStore } = await import('./log')
    const { log } = useLogStore()
    log('学习通账号添加成功', { type: 'success' })

    expect(messages).toEqual(['12:00:00 学习通账号添加成功'])
    expect(createDiscreteApi).not.toHaveBeenCalled()
  })

  it('does not interrupt the result when the browser message API is unavailable', async () => {
    vi.stubGlobal('window', {})
    createDiscreteApi.mockReturnValue({ message: undefined })
    const { useLogStore } = await import('./log')
    const { log } = useLogStore()

    expect(() => log('学习通账号添加成功', { type: 'success' })).not.toThrow()
    expect(messages).toEqual(['12:00:00 学习通账号添加成功'])
  })

  it('keeps the result when the browser message API throws', async () => {
    vi.stubGlobal('window', {})
    createDiscreteApi.mockImplementation(() => { throw new Error('UI unavailable') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { useLogStore } = await import('./log')
    const { log } = useLogStore()

    expect(() => log('学习通账号添加成功', { type: 'success' })).not.toThrow()
    expect(messages).toEqual(['12:00:00 学习通账号添加成功'])
  })

  it('shows browser messages and reuses the message API', async () => {
    vi.stubGlobal('window', {})
    const create = vi.fn()
    createDiscreteApi.mockReturnValue({ message: { create } })
    const { useLogStore } = await import('./log')
    const { log } = useLogStore()
    log('账号一', { type: 'success' })
    log('账号二', { type: 'success' })

    expect(messages).toEqual(['12:00:00 账号一', '12:00:00 账号二'])
    expect(createDiscreteApi).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(2)
  })
})
