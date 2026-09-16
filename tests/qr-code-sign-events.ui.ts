import { afterEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import Operation from '../components/Operation.vue'

const link = 'https://mobilelearn.chaoxing.com/widget/sign/e?id=100&c=200&enc=FIXTURE'
const job = { id: 'job-one', uid: 'cx-a', activityId: '100', state: 'queued', message: '已进入服务器扫码队列' }

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, (event: { data: string }) => void>()
  onerror?: () => void
  closed = false
  constructor(_url: string) { FakeEventSource.instances.push(this) }
  addEventListener(name: string, callback: (event: { data: string }) => void) { this.listeners.set(name, callback) }
  emit(name: string, data: unknown) { this.listeners.get(name)?.({ data: JSON.stringify(data) }) }
  close() { this.closed = true }
}

let app: ReturnType<typeof Vue.createApp> | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  app?.unmount()
  container?.remove()
  FakeEventSource.instances = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('shows the first same-activity result in two open browser clients, with one submitted task', async () => {
  for (const [name, value] of Object.entries({
    ref: Vue.ref, computed: Vue.computed, toRef: Vue.toRef, unref: Vue.unref,
    watch: Vue.watch, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount,
  }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }))
  vi.stubGlobal('useLogStore', () => ({ log: vi.fn() }))
  const account = Vue.reactive({ uid: 'cx-a', selected: true, info: { realname: 'Student A' } })
  const signByQrCode = vi.fn()
    .mockResolvedValueOnce({ state: 'accepted', job })
    .mockResolvedValueOnce({ state: 'busy', job })
  const accountStore = Vue.reactive({
    accounts: [account],
    selectAccounts: Vue.computed(() => account.selected ? [account] : []),
    signByQrCode,
  })
  vi.stubGlobal('useAccountStore', () => accountStore)
  const button = Vue.defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) { return () => Vue.h('button', { disabled: attrs.disabled, onClick: attrs.onClick }, slots.default?.()) },
  })
  const text = Vue.defineComponent({ setup(_, { slots }) { return () => Vue.h('span', slots.default?.()) } })
  let detectedLink = link
  const modal = Vue.defineComponent({
    props: ['show'], emits: ['success'],
    setup(props, { emit, slots }) {
      return () => props.show ? Vue.h('div', [
        Vue.h('button', { class: 'submit-qr', onClick: () => emit('success', detectedLink) }, '提交 URL'),
        slots.result?.(),
      ]) : null
    },
  })
  app = Vue.createApp({ render: () => Vue.h('div', [Vue.h(Operation), Vue.h(Operation)]) })
  app.config.warnHandler = () => {}
  for (const name of ['NButton', 'NCheckbox'])
    app.component(name, button)
  app.component('NText', text)
  app.component('QrCodeSignModal', modal)
  container = document.createElement('div')
  document.body.append(container)
  app.mount(container)
  const openButtons = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(item => item.textContent?.includes('批量扫码'))
  expect(openButtons).toHaveLength(2)
  for (const button of openButtons)
    button.click()
  await Vue.nextTick()
  expect(FakeEventSource.instances).toHaveLength(2)
  for (const button of container.querySelectorAll<HTMLButtonElement>('.submit-qr'))
    button.click()
  await vi.waitFor(() => expect(signByQrCode).toHaveBeenCalledTimes(2))
  expect(signByQrCode.mock.calls[0][0]).toBe('cx-a')
  expect(signByQrCode.mock.calls[1][0]).toBe('cx-a')
  for (const source of FakeEventSource.instances)
    source.emit('job', { ...job, state: 'success', message: '签到成功', result: '签到成功', sequence: 3 })
  await Vue.nextTick()
  const resultLists = container.querySelectorAll('[aria-label="各账号扫码结果"]')
  expect(resultLists).toHaveLength(2)
  for (const list of resultLists)
    expect(list.textContent).toContain('签到成功')
  await new Promise(resolve => setTimeout(resolve, 0))

  const nextJob = { ...job, id: 'job-two', activityId: '101', state: 'running', message: '正在处理首个活动' }
  for (const source of FakeEventSource.instances)
    source.emit('job', { ...nextJob, sequence: 4 })
  detectedLink = link.replace('id=100', 'id=102')
  signByQrCode.mockResolvedValueOnce({ state: 'busy', job: nextJob })
  container.querySelectorAll<HTMLButtonElement>('.submit-qr')[1].click()
  await vi.waitFor(() => expect(signByQrCode).toHaveBeenCalledTimes(3))
  for (const source of FakeEventSource.instances)
    source.emit('job', { ...nextJob, state: 'success', message: '签到成功', result: '签到成功', sequence: 5 })
  await Vue.nextTick()
  expect(resultLists[1].textContent).toContain('你提交的活动 102 尚未执行')
  expect(resultLists[1].textContent).toContain('重新提交该 URL')
  app.unmount()
  expect(FakeEventSource.instances.every(source => source.closed)).toBe(true)
  app = undefined
})
