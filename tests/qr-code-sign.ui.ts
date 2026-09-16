// Real mobile modal, Naive UI, Pinia and log store. Only hardware/network are mocked.
import { afterEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import * as VueUse from '@vueuse/core'
import * as UI from 'naive-ui'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import Operation from '../components/Operation.vue'
import QrCodeSignModal from '../components/QrCodeSignModal.client.vue'

vi.mock('vue-qrcode-reader', async () => {
  const { defineComponent, h } = await import('vue')
  const empty = defineComponent({ setup: () => () => null })
  return {
    QrcodeCapture: empty,
    QrcodeDropZone: empty,
    QrcodeStream: defineComponent({
      emits: ['detect'],
      setup: (_, { emit }) => () => h('button', {
        'data-testid': 'camera-frame',
        onClick: () => emit('detect', [{ rawValue: 'https://example.test/sign?id=100&c=200&enc=FIXTURE' }]),
      }, '模拟视频检测'),
    }),
  }
})

let app: ReturnType<typeof Vue.createApp> | undefined
it('creates the real message API', () => {
  const api = UI.createDiscreteApi(['message'])
  expect(api.message).toBeDefined()
  api.unmount()
})
afterEach(() => {
  app?.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('shows batch failures inside the real modal after a video detection event', async () => {
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
  buttons().find(button => button.textContent?.includes('批量扫码'))!.click()
  await vi.waitFor(() => expect(document.querySelector('[data-testid="camera-frame"]')).not.toBeNull())
  document.querySelector<HTMLButtonElement>('[data-testid="camera-frame"]')!.click()
  await vi.waitFor(() => expect(document.querySelector('[aria-label="各账号扫码结果"]')?.textContent).toContain('模拟：登录已过期'))
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(document.querySelector('[aria-label="各账号扫码结果"]')?.textContent).toContain('fixture-b (fixture-b): 模拟：登录已过期'))
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('批量扫码完成')
  expect(errors).toEqual([])
  app.unmount()
  app = undefined
  container.remove()
})
