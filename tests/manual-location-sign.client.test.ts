import { afterEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')

afterEach(() => {
  if (originalGeolocation)
    Object.defineProperty(navigator, 'geolocation', originalGeolocation)
  else
    Reflect.deleteProperty(navigator, 'geolocation')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('gets a new browser position for each manual location sign and sends it with the request', async () => {
  let readings = 0
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: (success: PositionCallback) => success({
      coords: { latitude: 39 + ++readings / 10, longitude: 116.4 },
    } as GeolocationPosition),
  } })
  for (const [name, value] of Object.entries({ ref: Vue.ref, computed: Vue.computed, watch: Vue.watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('defineStore', defineStore)
  vi.stubGlobal('useLogStore', () => ({ log: vi.fn() }))
  const request = vi.fn()
    .mockResolvedValueOnce({ data: { activity: { id: 1, otherId: 4 }, result: '签到成功' } })
    .mockResolvedValueOnce({ data: [] })
  vi.stubGlobal('request', request)
  setActivePinia(createPinia())
  const { useAccountStore } = await import('../stores/account')
  const account = useAccountStore()
  const course = { courseId: 'course-1', name: '课程' } as any
  const activity = { id: 1, otherId: 4 } as any

  await account.signByActivity('student', course, activity)
  await account.signByCourse('student', course)

  expect(readings).toBe(2)
  expect(request.mock.calls[0][1].body.location).toEqual({ latitude: 39.1, longitude: 116.4 })
  expect(request.mock.calls[1][1].body.location).toEqual({ latitude: 39.2, longitude: 116.4 })
})
