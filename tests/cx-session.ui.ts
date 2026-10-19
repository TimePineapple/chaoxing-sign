import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import AccountItem from '../components/AccountItem.vue'
import AccountLoginModal from '../components/AccountLoginModal.client.vue'
import Operation from '../components/Operation.vue'

let app: ReturnType<typeof Vue.createApp> | undefined
let container: HTMLDivElement
let instance: any
let store: any
const wrapper = Vue.defineComponent({
  setup(_, { slots }) { return () => Vue.h('div', [slots.header?.(), slots.default?.(), slots.action?.()]) },
})
const button = Vue.defineComponent({
  setup(_, { attrs, slots }) { return () => Vue.h('button', { ...attrs, disabled: attrs.disabled || attrs.loading }, slots.default?.()) },
})
const noop = Vue.defineComponent({ setup: () => () => null })

beforeEach(() => {
  store = Vue.reactive({ accounts: [{ uid: 'cx-a', username: '13800000000', loginExpired: true, selected: false },
    { uid: 'cx-b', selected: false }], relogin: vi.fn().mockResolvedValue({ info: { realname: 'Student' } }),
    login: vi.fn(), accountSyncLoading: false, courseSyncLoading: false })
  store.selectAccounts = Vue.computed(() => store.accounts.filter((account: any) => account.selected && !account.loginExpired))
  for (const [name, value] of Object.entries({
    ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, unref: Vue.unref,
    toRef: Vue.toRef, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount,
    useAccountStore: () => store, useLogStore: () => ({ log: vi.fn() }),
    isPhone: () => true, navigateTo: vi.fn(),
  })) vi.stubGlobal(name, value)
  container = document.createElement('div')
  document.body.append(container)
})
afterEach(() => { app?.unmount(); container.remove(); vi.unstubAllGlobals() })

function mount(component: any, props: any = {}) {
  app = Vue.createApp({ render: () => Vue.h(component, { ...props, ref: (value: any) => { instance = value } }) })
  app.config.warnHandler = () => {}
  for (const name of ['NCard', 'NSpin', 'NText', 'NForm', 'NFormItem', 'NModal', 'NAlert']) app.component(name, wrapper)
  app.component('NButton', button)
  app.component('NInput', Vue.defineComponent({
    props: ['modelValue', 'disabled', 'type'],
    setup(props) { return () => Vue.h('input', { value: props.modelValue, disabled: props.disabled, type: props.type }) },
  }))
  for (const name of ['NAvatar', 'NCheckbox', 'Icon', 'QrCodeSignModal', 'CodeOrGestureSignModal', 'SignHistory', 'SettingModal', 'AccountLoginModal']) app.component(name, noop)
  app.mount(container)
  return instance.$.setupState
}

it('keeps the expiry message and two recovery buttons inside the original card and prevents account selection', async () => {
  const click = vi.fn()
  mount(AccountItem, { uid: 'cx-a', username: '13800000000', info: { realname: 'Student' }, setting: {},
    lastLoginTime: '2026-10-01', loginExpired: true, onClick: click })
  const card = container.querySelector('.account-card') as HTMLElement
  expect(card.classList.contains('account-card-expired')).toBe(true)
  const overlay = card.querySelector('.account-expired-overlay')!
  expect(overlay.textContent).toContain('登陆状态失效，请重新登录')
  expect([...overlay.querySelectorAll('button')].map(button => button.textContent)).toEqual(['重新登录', '尝试自动续登'])
  expect(card.querySelector('.account-actions')?.hasAttribute('inert')).toBe(true)
  card.click()
  expect(click).not.toHaveBeenCalled()
  ;(overlay.querySelectorAll('button')[0] as HTMLButtonElement).click()
  await Vue.nextTick()
  expect(instance.$.setupState.showReloginModal).toBe(true)
  expect(click).not.toHaveBeenCalled()
})

it('runs saved-credential recovery only once while loading and preserves a useful failure', async () => {
  let reject!: (error: unknown) => void
  store.relogin.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
  const state = mount(AccountItem, { uid: 'cx-a', info: { realname: 'Student' }, setting: {}, lastLoginTime: '2026-10-01', loginExpired: true })
  const pending = state.tryRenewSession()
  await Vue.nextTick()
  expect([...container.querySelectorAll('.account-expired-actions button')].every(button => (button as HTMLButtonElement).disabled)).toBe(true)
  await state.tryRenewSession()
  expect(store.relogin).toHaveBeenCalledTimes(1)
  expect(store.relogin).toHaveBeenCalledWith('cx-a')
  reject({ data: { message: '密码错误' } })
  await pending
  await Vue.nextTick()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('密码错误')
  expect(container.querySelector('.account-expired-overlay')).not.toBeNull()
})

it('opens manual reauthentication with a locked username and empty password, allowing an existing account', async () => {
  const state = mount(AccountLoginModal, { account: { uid: 'cx-a', username: '13800000000' } })
  const inputs = container.querySelectorAll('input')
  expect(inputs[0].value).toBe('13800000000')
  expect(inputs[0].disabled).toBe(true)
  expect(inputs[1].value).toBe('')
  state.form.password = 'new-password-fixture'
  state.formRef = { validate: vi.fn().mockResolvedValue(undefined) }
  await state.addAccount()
  expect(store.relogin).toHaveBeenCalledWith('cx-a', 'new-password-fixture')
  expect(store.login).not.toHaveBeenCalled()
  expect(state.form.password).toBe('')
})

it('excludes expired accounts when selecting all or retrying failed accounts', async () => {
  const state = mount(Operation)
  state.isAllChecked = true
  state.handleCheckedChange()
  expect(store.accounts.map((account: any) => account.selected)).toEqual([false, true])
  state.qrCodeResults = [{ uid: 'cx-a', status: 'error', errorCode: 'CX_SESSION_EXPIRED' }, { uid: 'cx-b', status: 'error' }]
  state.handleRetryFailed()
  expect(store.accounts.map((account: any) => account.selected)).toEqual([false, true])
  expect(state.failedCourseSyncUids).toEqual([])
})
