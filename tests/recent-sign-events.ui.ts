import { afterEach, expect, it, vi } from 'vitest'
import { connectRecentSignEvents } from '../utils/recentSignEvents.client'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, (event: { data: string }) => void>()
  closed = false
  constructor(public url: string) { FakeEventSource.instances.push(this) }
  addEventListener(name: string, callback: (event: { data: string }) => void) { this.listeners.set(name, callback) }
  emit(name: string, data: unknown) { this.listeners.get(name)?.({ data: JSON.stringify(data) }) }
  close() { this.closed = true }
}

afterEach(() => {
  FakeEventSource.instances = []
  vi.unstubAllGlobals()
})

it('receives server sign events and refreshes only when the stream reconnects', () => {
  vi.stubGlobal('EventSource', FakeEventSource)
  const onSign = vi.fn()
  const onReconnect = vi.fn()
  const close = connectRecentSignEvents(onSign, onReconnect)
  const source = FakeEventSource.instances[0]
  expect(source.url).toBe('/api/cx/recent-sign-events')
  source.emit('open', {})
  expect(onReconnect).not.toHaveBeenCalled()
  const event = { uid: 'cx-a', sign: { name: '高等数学', time: '2026-09-17T00:00:00.000Z' } }
  source.emit('sign', event)
  expect(onSign).toHaveBeenCalledWith(event)
  source.emit('open', {})
  expect(onReconnect).toHaveBeenCalledOnce()
  close()
  expect(source.closed).toBe(true)
})
