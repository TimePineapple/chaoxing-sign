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
      props: { constraints: Object, formats: Array, track: Function, torch: Boolean },
      emits: ['detect', 'camera-on', 'error'],
      setup: (props, { emit }) => {
        let zoom = 1
        const constraints = () => props.constraints as { deviceId?: { exact?: string }; width?: { ideal?: number }; height?: { ideal?: number } }
        onMounted(() => emit('camera-on'))
        watch(() => props.constraints, () => emit('camera-on'), { deep: true })
        return () => h('div', [
          h('video', { ref: (element: HTMLVideoElement | null) => {
            if (element) {
              Object.defineProperty(element, 'srcObject', { configurable: true, value: {
                getVideoTracks: () => [{
                  getCapabilities: () => ({ focusMode: ['continuous'], zoom: { min: 1, max: 4, step: 0.1 } }),
                  applyConstraints: async (options: { advanced?: { zoom?: number }[] }) => {
                    const requestedZoom = options.advanced?.[0]?.zoom
                    if (requestedZoom !== undefined)
                      zoom = requestedZoom
                  },
                  getSettings: () => ({
                    deviceId: (props.constraints as { deviceId?: { exact?: string } })?.deviceId?.exact || 'rear-main',
                    facingMode: 'environment',
                    width: constraints()?.width?.ideal ?? 1280,
                    height: constraints()?.height?.ideal ?? 720,
                    zoom,
                  }),
                }],
              } })
            }
          } }),
          h('button', {
            'data-testid': 'camera-frame',
            'data-device-id': (props.constraints as { deviceId?: { exact?: string } })?.deviceId?.exact,
            'data-facing-mode': (props.constraints as { facingMode?: { ideal?: string } })?.facingMode?.ideal,
            'data-width': constraints()?.width?.ideal,
            'data-height': constraints()?.height?.ideal,
            'data-tracking': Boolean(props.track),
            'data-formats': props.formats?.join(','),
            onClick: () => emit('detect', [{ rawValue: 'https://example.test/sign?id=100&c=200&enc=FIXTURE' }]),
          }, '模拟视频检测'),
          h('button', {
            'data-testid': 'camera-error',
            onClick: () => emit('error', { name: 'OverconstrainedError', constraint: 'width' }),
          }, '模拟相机配置不支持'),
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

it('shows the dynamic-code waiting hint and batch failures inside the real modal', async () => {
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
  document.querySelector<HTMLElement>('.dynamic-code-toggle')!.click()
  await Vue.nextTick()
  buttons().find(button => button.textContent?.includes('批量扫码'))!.click()
  await vi.waitFor(() => expect(document.querySelector('[data-testid="camera-frame"]')).not.toBeNull())
  await vi.waitFor(() => expect(locationRequests).toBeGreaterThan(requestsBeforeOpening))
  expect(document.querySelector('[data-testid="camera-frame"]')?.getAttribute('data-facing-mode')).toBe('environment')
  const cameraFrame = () => document.querySelector('[data-testid="camera-frame"]')
  expect(cameraFrame()?.getAttribute('data-width')).toBe('3840')
  expect(cameraFrame()?.getAttribute('data-height')).toBe('2160')
  expect(cameraFrame()?.getAttribute('data-tracking')).toBe('true')
  expect(cameraFrame()?.getAttribute('data-formats')).toBe('qr_code')
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('远距离模式：')
  await vi.waitFor(() => expect(document.querySelector('.camera-zoom-control label')?.textContent).toContain('2.0×'))
  const zoomControl = document.querySelector<HTMLInputElement>('#qr-camera-zoom')!
  zoomControl.value = '2.7'
  zoomControl.dispatchEvent(new Event('change', { bubbles: true }))
  await vi.waitFor(() => expect(document.querySelector('.camera-zoom-control label')?.textContent).toContain('2.7×'))
  document.querySelector<HTMLButtonElement>('[data-testid="camera-error"]')!.click()
  await vi.waitFor(() => expect(cameraFrame()?.getAttribute('data-width')).toBe('1920'))
  document.querySelector<HTMLButtonElement>('[data-testid="camera-error"]')!.click()
  await vi.waitFor(() => expect(cameraFrame()?.getAttribute('data-width')).toBeNull())
  const switchButton = () => buttons().find(button => button.textContent?.includes('后置镜头切换'))
  await vi.waitFor(() => expect(switchButton()?.disabled).toBe(false))
  for (const deviceId of ['rear-tele', 'rear-wide', 'rear-main']) {
    switchButton()!.click()
    await vi.waitFor(() => expect(document.querySelector('[data-testid="camera-frame"]')?.getAttribute('data-device-id')).toBe(deviceId))
    await vi.waitFor(() => expect(switchButton()?.disabled).toBe(false))
    expect(cameraFrame()?.getAttribute('data-width')).toBe('3840')
  }
  expect(document.querySelector('[data-testid="camera-frame"]')?.getAttribute('data-device-id')).not.toBe('front')
  document.querySelector<HTMLButtonElement>('[data-testid="camera-frame"]')!.click()
  await vi.waitFor(() => expect(document.querySelector('[data-testid="dynamic-code-waiting-hint"]')?.textContent?.trim()).toBe('正在等待二维码刷新'))
  switchButton()!.click()
  await vi.waitFor(() => expect(document.querySelector('[data-testid="dynamic-code-waiting-hint"]')).toBeNull())
  document.querySelector<HTMLElement>('.dynamic-code-toggle')!.click()
  await Vue.nextTick()
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
