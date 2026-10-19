import type { Account } from '../types/account'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'

vi.mock('naive-ui', () => ({ createDiscreteApi: () => ({ message: { error: vi.fn() } }) }))

const request = vi.fn()
const log = vi.fn()
const course = { courseId: 'old', classId: 'class', name: '原课程' }
let useAccountStore: typeof import('../stores/account')['useAccountStore']

beforeEach(async () => {
  for (const [name, value] of Object.entries({ ref, computed, watch, defineStore, request, useLogStore: () => ({ log }) }))
    vi.stubGlobal(name, value)
  setActivePinia(createPinia())
  request.mockReset()
  log.mockReset()
  useAccountStore = (await import('../stores/account')).useAccountStore
})

afterEach(() => vi.unstubAllGlobals())

function fixture() {
  const store = useAccountStore()
  store.accounts = ['a', 'b', 'c'].map(uid => ({ uid, selected: true, info: { realname: uid }, courses: [course] })) as Account[]
  return store
}

it('syncs a fixed, deduplicated account list sequentially, preserving courses on business failures', async () => {
  const store = fixture()
  let finishFirst!: (value: unknown) => void
  request.mockReturnValueOnce(new Promise((resolve) => {
    finishFirst = resolve
  }))
    .mockResolvedValueOnce({ code: 500, message: '课程服务异常', data: [] })
    .mockResolvedValueOnce({ code: 200, data: [] })
  const ids = ['a', 'b', 'a', 'c']
  const syncing = store.syncCourses(ids)
  ids.splice(0)
  expect(store.courseSyncLoading).toBe(true)
  expect(request).toHaveBeenCalledTimes(1)
  await store.syncCourses(['a'])
  await store.syncAccounts()
  expect(request).toHaveBeenCalledTimes(1)
  const updated = [{ ...course, courseId: 'new' }]
  finishFirst({ code: 200, data: updated })
  expect(await syncing).toEqual([{ uid: 'a', success: true }, { uid: 'b', success: false }, { uid: 'c', success: true }])
  expect(request.mock.calls.map(([, options]) => options.params.uid)).toEqual(['a', 'b', 'c'])
  expect(store.accounts.map(account => account.courses)).toEqual([updated, [course], []])
  expect(store.accounts.every(account => account.selected)).toBe(true)
  expect(log).toHaveBeenCalledWith('b (b) 课程同步失败：课程服务异常', { type: 'error' })
  expect(store.courseSyncLoading).toBe(false)
})

it('continues after network errors or malformed course responses without discarding saved courses', async () => {
  const store = fixture()
  request.mockRejectedValueOnce({ data: { message: '网络失败' } })
    .mockResolvedValueOnce({ code: 200, data: null })
    .mockResolvedValueOnce({ code: 200, data: [course] })
  expect(await store.syncCourses(['a', 'b', 'c'])).toEqual([
    { uid: 'a', success: false },
    { uid: 'b', success: false },
    { uid: 'c', success: true },
  ])
  expect(store.accounts.every(account => account.courses[0]?.courseId === 'old')).toBe(true)
  expect(store.courseSyncLoading).toBe(false)
})

it('loads account information without requesting courses and excludes course sync until it finishes', async () => {
  const store = fixture()
  let finish!: (value: unknown) => void
  request.mockReturnValueOnce(new Promise((resolve) => {
    finish = resolve
  }))
  const syncing = store.syncAccounts()
  expect(store.accountSyncLoading).toBe(true)
  await store.syncCourses(['a'])
  await store.syncAccounts()
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith('/api/cx/accounts')
  finish({ code: 200, data: store.accounts })
  await syncing
  expect(store.accountSyncLoading).toBe(false)
  expect(await store.syncCourses([])).toEqual([])
  expect(await store.syncCourses(['missing'])).toEqual([])
  expect(request).toHaveBeenCalledTimes(1)
})

it('preserves courses on expiry, excludes expired accounts and ignores old session events after recovery', async () => {
  const store = fixture()
  store.accounts.forEach(account => { account.lastLoginTime = '2026-10-01T00:00:00.000Z' })
  store.applyAccountSession({ uid: 'a', loginExpired: true, lastLoginTime: '2026-10-01T00:00:00.000Z' })
  expect(store.accounts[0].selected).toBe(false)
  expect(store.accounts[0].courses).toEqual([course])
  expect(store.selectAccounts.map(account => account.uid)).toEqual(['b', 'c'])
  await expect(store.getCourses('a')).rejects.toThrow('登陆状态失效')
  expect(request).not.toHaveBeenCalled()
  request.mockResolvedValueOnce({ code: 200, data: [] })
  expect(await store.syncCourses(['a', 'b'])).toEqual([{ uid: 'b', success: true }])
  request.mockResolvedValueOnce({ code: 200, data: { uid: 'a', info: { realname: 'a', logged: true }, lastLoginTime: '2026-10-19T00:00:00.000Z' } })
  await store.relogin('a', 'new-password-fixture')
  expect(store.accounts).toHaveLength(3)
  expect(store.accounts[0]).toMatchObject({ loginExpired: false, selected: false, courses: [course] })
  store.applyAccountSession({ uid: 'a', loginExpired: true, lastLoginTime: '2026-10-01T00:00:00.000Z' })
  expect(store.accounts[0].loginExpired).toBe(false)
})

it('retains an expiry event received before the account-list request finishes', async () => {
  const store = useAccountStore()
  store.applyAccountSession({ uid: 'a', loginExpired: true, lastLoginTime: '2026-10-01T00:00:00.000Z' })
  request.mockResolvedValue({ data: [{ uid: 'a', selected: true, info: {}, lastLoginTime: '2026-10-01T00:00:00.000Z' }] })
  await store.syncAccounts()
  expect(store.accounts[0]).toMatchObject({ loginExpired: true, selected: false })
})
