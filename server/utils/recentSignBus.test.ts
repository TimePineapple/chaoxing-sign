import { expect, it, vi } from 'vitest'
import { recentSignBus } from './recentSignBus'

it('publishes a completed sign to every connection of its owner only', () => {
  const a1 = vi.fn()
  const a2 = vi.fn()
  const b = vi.fn()
  const closeA1 = recentSignBus.subscribe('web-a', a1)
  const closeA2 = recentSignBus.subscribe('web-a', a2)
  const closeB = recentSignBus.subscribe('web-b', b)
  const event = { uid: 'cx-a', sign: { name: '高等数学', time: '2026-09-17T00:00:00.000Z' } }
  recentSignBus.publish('web-a', event)
  expect(a1).toHaveBeenCalledWith(event)
  expect(a2).toHaveBeenCalledWith(event)
  expect(b).not.toHaveBeenCalled()
  closeA1()
  closeA2()
  closeB()
})
