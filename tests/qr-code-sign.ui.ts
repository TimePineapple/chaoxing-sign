// Real mobile modal, Naive UI, Pinia and log store. Only hardware/network are mocked.
import { afterEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import * as VueUse from '@vueuse/core'
import * as UI from 'naive-ui'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import Operation from '../components/Operation.vue'
import QrCodeSignModal from '../components/QrCodeSignModal.client.vue'

vi.mock('vue-qrcode-reader', async () => {
  const { defineComponent, h, onMounted, watch } = await import('vue')
  const empty = defineComponent({ setup: () => () => null })
  return {
    QrcodeCapture: empty,
    QrcodeDropZone: empty,
    QrcodeStream: defineComponent({
      props: { constraints: Object },
      emits: ['detect', 'camera-on'],
      setup: (props, { emit }) => {
        onMounted(() => emit('camera-on'))
        watch(() => props.constraints, () => emit('camera-on'), { deep: true })
        return () => h('div', [
          h('video', { ref: (element: HTMLVideoElement | null) => {
            if (element) {
              Object.defineProperty(element, 'srcObject', { configurable: true, value: {
                getVideoTracks: () => [{ getSettings: () => ({
                  deviceId: (props.constraints as { deviceId?: { exact?: string } })?.deviceId?.exact || 'rear-main',
                  facingMode: 'environment',
                }) }],
              } })
            }
          } }),
          h('button', {
            'data-testid': 'camera-frame',
            'data-device-id': (props.constraints as { deviceId?: { exact?: string } })?.deviceId?.exact,
            'data-facing-mode': (props.constraints as { facingMode?: { ideal?: string } })?.facingMode?.ideal,
            onClick: () => emit('detect', [{ rawValue: 'https://example.test/sign?id=100&c=200&enc=FIXTURE' }]),
          }, '模拟视频检测'),
        ])
      },
    }),
  }
})

let app: ReturnType<typeof Vue.createApp> | undefined
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
it('creates the real message API', () => {
  const api = UI.createDiscreteApi(['message'])
  expect(api.message).toBeDefined()
  api.unmount()
})
afterEach(() => {
  app?.unmount()
  if (originalGeolocation)
    Object.defineProperty(navigator, 'geolocation', originalGeolocation)
  else
    Reflect.deleteProperty(navigator, 'geolocation')
  if (originalMediaDevices)
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else
    Reflect.deleteProperty(navigator, 'mediaDevices')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('shows batch failures inside the real modal after a video detection event', async () => {
  let locationRequests = 0
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    enumerateDevices: vi.fn().mockResolvedValue([
      { kind: 'videoinput', deviceId: 'rear-main', label: 'Back Camera' },
      { kind: 'videoinput', deviceId: 'front', label: 'Front Camera' },
      { kind: 'videoinput', deviceId: 'rear-wide', label: 'Back Ultra Wide Camera' },
      { kind: 'videoinput', deviceId: 'rear-tele', label: 'Rear Telephoto Camera' },
    ]),
  } })
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: (success: PositionCallback) => {
      locationRequests++
      success({ coords: { latitude: 39.9, longitude: 116.4 } } as GeolocationPosition)
    },
  } })
  for (const [name, value] of Object.entries({
    ref: Vue.ref, computed: Vue.computed, toRef: Vue.toRef, unref: Vue.unref,
    watch: Vue.watch, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount, defineStore,
    useLocalStorage: VueUse.useLocalStorage, useNow: VueUse.useNow, useDateFormat: VueUse.useDateFormat,
  }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('useMessage', UI.useMessage)
  const { useLogStore } = await import('../stores/log')
  vi.stubGlobal('useLogStore', useLogStore)
  const { useAccountStore } = await import('../stores/account')
  vi.stubGlobal('useAccountStore', useAccountStore)
  const request = vi.fn().mockRejectedValue({ statusCode: 401, data: { message: '模拟：登录已过期' } })
  vi.stubGlobal('request', request)
  const pinia = createPinia()
  setActivePinia(pinia)
  const errors: unknown[] = []
  app = Vue.createApp({
    setup: () => () => Vue.h(UI.NConfigProvider, { clsPrefix: 'n' }, {
      default: () => Vue.h(UI.NMessageProvider, null, { default: () => Vue.h(Operation) }),
    }),
  })
  app.config.errorHandler = error => errors.push(error)
  app.config.warnHandler = () => {}
  for (const name of ['NModal', 'NSpace', 'NButton', 'NText', 'NImage', 'NInput', 'NInputGroup', 'NCheckbox'] as const)
    app.component(name, UI[name])
  app.component('QrCodeSignModal', QrCodeSignModal)
  app.component('Icon', { render: () => null })
  app.component('CodeOrGestureSignModal', { render: () => null })
  const accounts = useAccountStore()
  accounts.accounts = ['fixture-a', 'fixture-b'].map(uid => ({ uid, selected: true, info: { realname: uid } })) as any
  app.use(pinia)
  const container = document.createElement('div')
  document.body.append(container)
  app.mount(container)
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')]
  const requestsBeforeOpening = locationRequests
  buttons().find(button => button.textContent?.includes('批量扫码'))!.click()
  await vi.waitFor(() => expect(document.querySelector('[data-testid="camera-frame"]')).not.toBeNull())
  await vi.waitFor(() => expect(locationRequests).toBeGreaterThan(requestsBeforeOpening))
  expect(document.querySelector('[data-testid="camera-frame"]')?.getAttribute('data-facing-mode')).toBe('environment')
  const switchButton = () => buttons().find(button => button.textContent?.includes('后置镜头切换'))
  await vi.waitFor(() => expect(switchButton()?.disabled).toBe(false))
  for (const deviceId of ['rear-tele', 'rear-wide', 'rear-main']) {
    switchButton()!.click()
    await vi.waitFor(() => expect(document.querySelector('[data-testid="camera-frame"]')?.getAttribute('data-device-id')).toBe(deviceId))
    await vi.waitFor(() => expect(switchButton()?.disabled).toBe(false))
  }
  expect(document.querySelector('[data-testid="camera-frame"]')?.getAttribute('data-device-id')).not.toBe('front')
  const requestsBeforeSubmit = locationRequests
  document.querySelector<HTMLButtonElement>('[data-testid="camera-frame"]')!.click()
  await vi.waitFor(() => expect(document.querySelector('[aria-label="各账号扫码结果"]')?.textContent).toContain('模拟：登录已过期'))
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(request.mock.calls.map(([, options]) => options.body.location)).toEqual([
    { latitude: 39.9, longitude: 116.4 },
    { latitude: 39.9, longitude: 116.4 },
  ])
  expect(locationRequests).toBe(requestsBeforeSubmit)
  await vi.waitFor(() => expect(document.querySelector('[aria-label="各账号扫码结果"]')?.textContent).toContain('fixture-b (fixture-b): 模拟：登录已过期'))
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('批量扫码完成')
  expect(errors).toEqual([])
  app.unmount()
  app = undefined
  container.remove()
})
