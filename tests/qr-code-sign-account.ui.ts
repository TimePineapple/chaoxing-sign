import { afterEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import AccountItem from '../components/AccountItem.vue'

const link = 'https://mobilelearn.chaoxing.com/widget/sign/e?id=100&c=200&enc=FIXTURE'

class FakeEventSource {
  static current?: FakeEventSource
  listeners = new Map<string, (event: { data: string }) => void>()
  constructor(_url: string) { FakeEventSource.current = this }
  addEventListener(name: string, callback: (event: { data: string }) => void) { this.listeners.set(name, callback) }
  emit(name: string, data: unknown) { this.listeners.get(name)?.({ data: JSON.stringify(data) }) }
  close() {}
}

let app: ReturnType<typeof Vue.createApp> | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  app?.unmount()
  container?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('shows a server-pushed final result in the single-account scan modal', async () => {
  for (const [name, value] of Object.entries({ ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, unref: Vue.unref, onBeforeUnmount: Vue.onBeforeUnmount }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('EventSource', FakeEventSource)
  const job = { id: 'job-one', uid: 'cx-a', activityId: '100', state: 'queued', message: '已入队' }
  const signByQrCode = vi.fn().mockResolvedValue({ state: 'accepted', job })
  vi.stubGlobal('useAccountStore', () => ({ signByQrCode }))
  const wrapper = Vue.defineComponent({
    setup(_, { slots }) { return () => Vue.h('div', [slots.header?.(), slots.default?.(), slots.action?.()]) },
  })
  const modal = Vue.defineComponent({
    props: ['show'],
    setup(props, { slots }) { return () => props.show ? Vue.h('div', { class: 'single-result' }, slots.result?.()) : null },
  })
  const noop = Vue.defineComponent({ setup: () => () => null })
  let accountInstance: any
  app = Vue.createApp({ render: () => Vue.h(AccountItem, {
    ref: (value: unknown) => { accountInstance = value },
    uid: 'cx-a', info: { realname: 'Student A', siteName: 'School' }, setting: {}, lastLoginTime: '2026-01-01',
  } as any) })
  app.config.warnHandler = () => {}
  for (const name of ['NSpin', 'NCard', 'NButton', 'NText', 'NAvatar', 'NCheckbox'])
    app.component(name, wrapper)
  app.component('QrCodeSignModal', modal)
  for (const name of ['CodeOrGestureSignModal', 'SignHistory', 'SettingModal', 'Icon'])
    app.component(name, noop)
  container = document.createElement('div')
  document.body.append(container)
  app.mount(container)
  accountInstance.$.setupState.showQrCodeModal = true
  await Vue.nextTick()
  await accountInstance.$.setupState.handleQrCodeSignSuccess(link)
  expect(signByQrCode).toHaveBeenCalledTimes(1)
  FakeEventSource.current?.emit('job', { ...job, state: 'success', message: '签到成功', result: '签到成功', sequence: 3 })
  await Vue.nextTick()
  expect(container.querySelector('.single-result')?.textContent).toContain('签到成功')
})

it('shows a recent course sign in 24-hour time and hides it at the 30-minute boundary', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 17, 23, 59, 59))
  for (const [name, value] of Object.entries({ ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, unref: Vue.unref, onBeforeUnmount: Vue.onBeforeUnmount }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useAccountStore', () => ({ refreshRecentSigns: vi.fn() }))
  const wrapper = Vue.defineComponent({
    setup(_, { slots }) { return () => Vue.h('div', [slots.header?.(), slots.default?.(), slots.action?.()]) },
  })
  const noop = Vue.defineComponent({ setup: () => () => null })
  const signedAt = new Date(2026, 8, 17, 23, 59, 59).toISOString()
  app = Vue.createApp({ render: () => Vue.h(AccountItem, {
    uid: 'cx-a', info: { realname: 'Student A', siteName: 'School' }, setting: {},
    lastLoginTime: signedAt, recentSign: { name: '高等数学', time: signedAt },
  } as any) })
  app.config.warnHandler = () => {}
  for (const name of ['NSpin', 'NCard', 'NButton', 'NText', 'NAvatar', 'NCheckbox'])
    app.component(name, wrapper)
  for (const name of ['QrCodeSignModal', 'CodeOrGestureSignModal', 'SignHistory', 'SettingModal', 'Icon'])
    app.component(name, noop)
  container = document.createElement('div')
  document.body.append(container)
  app.mount(container)

  expect(container.querySelector('.account-recent-sign')?.textContent).toContain('最近签到：高等数学 23:59:59')
  await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
  await Vue.nextTick()
  expect(container.querySelector('.account-recent-sign')).toBeNull()
})
