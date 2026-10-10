import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import AccountItem from '../components/AccountItem.vue'
import AccountList from '../components/AccountList.vue'
import Operation from '../components/Operation.vue'

vi.mock('../utils/recentSignEvents.client', () => ({ connectRecentSignEvents: () => () => {} }))
vi.mock('../utils/qrSignEvents.client', () => ({ connectQrSignEvents: () => () => {} }))

let app: ReturnType<typeof Vue.createApp> | undefined
let container: HTMLDivElement
let instance: any
const syncCourses = vi.fn()
const syncAccounts = vi.fn()
const refreshRecentSigns = vi.fn()
let store: any

const wrapper = Vue.defineComponent({
  setup(_, { slots }) { return () => Vue.h('div', [slots.header?.(), slots.default?.(), slots.action?.()]) },
})
const button = Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) { return () => Vue.h('button', { disabled: attrs.disabled || attrs.loading, onClick: attrs.onClick }, slots.default?.()) },
})
const modal = Vue.defineComponent({
  props: ['show', 'courseSyncAvailable', 'courseSyncLoading', 'courseSyncDisabled'],
  emits: ['sync-courses', 'retry-failed'],
  setup(props, { emit, slots }) {
    return () => props.show
      ? Vue.h('div', { class: 'scan-modal' }, [
        props.courseSyncAvailable && Vue.h('button', {
          class: 'sync-courses',
          disabled: props.courseSyncLoading || props.courseSyncDisabled,
          onClick: () => emit('sync-courses'),
        }, '同步课程'),
        Vue.h('button', { class: 'retry-failed', onClick: () => emit('retry-failed') }, '重新扫描'),
        slots.result?.(),
      ])
      : null
  },
})

beforeEach(() => {
  syncCourses.mockReset().mockResolvedValue([])
  syncAccounts.mockReset().mockResolvedValue(undefined)
  refreshRecentSigns.mockReset().mockResolvedValue(undefined)
  store = Vue.reactive({
    accounts: ['a', 'b', 'c'].map(uid => ({ uid, selected: uid !== 'c', info: { realname: uid }, courses: [] })),
    selectAccounts: Vue.computed(() => store.accounts.filter((account: any) => account.selected)),
    accountSyncLoading: false,
    courseSyncLoading: false,
    recentSigns: {},
    syncAccounts,
    syncCourses,
    refreshRecentSigns,
  })
  for (const [name, value] of Object.entries({
    ref: Vue.ref,
    computed: Vue.computed,
    toRef: Vue.toRef,
    unref: Vue.unref,
    watch: Vue.watch,
    onMounted: Vue.onMounted,
    tryOnMounted: Vue.onMounted,
    onBeforeUnmount: Vue.onBeforeUnmount,
    useAccountStore: () => store,
    useLogStore: () => ({ log: vi.fn() }),
    // A leftover deployment setting must no longer disable failure selection.
    useRuntimeConfig: () => ({ public: { qrCode: { autoSelectFailedOnRetry: false } } }),
  }))
    vi.stubGlobal(name, value)
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  app?.unmount()
  container.remove()
  vi.unstubAllGlobals()
})

function mount(component: any, props = {}) {
  app = Vue.createApp({ render: () => Vue.h(component, {
    ...props,
    ref: (value: unknown) => { instance = value },
  }) })
  app.config.warnHandler = () => {}
  for (const name of ['NCard', 'NSpin', 'NText', 'ClientOnly'])
    app.component(name, wrapper)
  app.component('NButton', button)
  app.component('QrCodeSignModal', modal)
  const empty = Vue.defineComponent({ setup: () => () => null })
  for (const name of ['AccountItem', 'AccountLoginModal', 'NEmpty', 'Icon', 'NCheckbox', 'NAvatar', 'SignHistory', 'SettingModal', 'CodeOrGestureSignModal'])
    app.component(name, empty)
  app.mount(container)
  return instance.$.setupState
}

it('automatically syncs account information only, and the home course button includes unselected accounts', async () => {
  mount(AccountList)
  await Vue.nextTick()
  expect(syncAccounts).toHaveBeenCalledTimes(1)
  expect(syncCourses).not.toHaveBeenCalled()
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button')]
  buttons().find(item => item.textContent?.trim() === '同步课程')!.click()
  expect(syncCourses).toHaveBeenCalledWith(['a', 'b', 'c'])
  buttons().find(item => item.textContent?.trim() === '同步账户信息')!.click()
  expect(syncAccounts).toHaveBeenCalledTimes(2)
  store.courseSyncLoading = true
  await Vue.nextTick()
  expect(buttons().find(item => item.textContent?.trim() === '同步账户信息')!.disabled).toBe(true)
  store.courseSyncLoading = false
  store.accounts = []
  await Vue.nextTick()
  expect(buttons().find(item => item.textContent?.trim() === '同步课程')!.disabled).toBe(true)
})

it('syncs only failed batch accounts after pending tasks finish, retaining feedback until an explicit rescan', async () => {
  const state = mount(Operation)
  state.showQrCodeModal = true
  await Vue.nextTick()
  expect(container.querySelector('.sync-courses')).toBeNull()
  state.qrCodeResults = [
    { uid: 'a', name: 'a', status: 'success', message: '签到成功' },
    { uid: 'b', name: 'b', status: 'error', message: '班级匹配失败' },
    { uid: 'c', name: 'c', status: 'pending', message: '正在签到' },
  ]
  await Vue.nextTick()
  expect(container.querySelector<HTMLButtonElement>('.sync-courses')!.disabled).toBe(true)
  state.qrCodeResults[2].status = 'error'
  await Vue.nextTick()
  const feedback = container.querySelector('[aria-label="各账号扫码结果"]')!.textContent
  container.querySelector<HTMLButtonElement>('.sync-courses')!.click()
  await Vue.nextTick()
  expect(syncCourses).toHaveBeenCalledWith(['b', 'c'])
  expect(store.accounts.map((account: any) => account.selected)).toEqual([true, true, false])
  expect(container.querySelector('.scan-modal')).not.toBeNull()
  expect(container.querySelector('[aria-label="各账号扫码结果"]')!.textContent).toBe(feedback)
  container.querySelector<HTMLButtonElement>('.retry-failed')!.click()
  await Vue.nextTick()
  expect(store.accounts.map((account: any) => account.selected)).toEqual([false, true, true])
  expect(state.qrCodeResults.map((row: any) => row.uid)).toEqual(['b', 'c'])
  expect(container.querySelector('.sync-courses')).toBeNull()
})

it('offers single-account course sync only for failures and keeps the modal and feedback open', async () => {
  const state = mount(AccountItem, { uid: 'b', info: { realname: 'b' }, setting: {}, lastLoginTime: '2026-01-01' })
  state.showQrCodeModal = true
  await Vue.nextTick()
  expect(container.querySelector('.sync-courses')).toBeNull()
  state.qrCodeResult = { status: 'success', message: '签到成功' }
  await Vue.nextTick()
  expect(container.querySelector('.sync-courses')).toBeNull()
  state.qrCodeResult = { status: 'error', message: '匹配失败' }
  await Vue.nextTick()
  container.querySelector<HTMLButtonElement>('.sync-courses')!.click()
  await Vue.nextTick()
  expect(syncCourses).toHaveBeenCalledWith(['b'])
  expect(container.querySelector('.scan-modal')!.textContent).toContain('匹配失败')
  expect(state.showQrCodeModal).toBe(true)
})
