import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ResOp } from '../server/utils'

const fixture = vi.hoisted(() => ({ uid: 'cx-a', logged: true, error: undefined as Error | undefined, login: vi.fn(), active: 0, maximum: 0 }))
vi.mock('../server/protocol/easemob', () => ({ IMConnectionMap: new Map() }))
vi.mock('../server/protocol/cx', () => ({
  CXMap: new Map(),
  CxLoginError: class extends Error {},
  Cx: class {
    user: any
    setting: any
    courseList: any[] = []
    constructor(user: any) { this.user = { ...user } }
    async login() {
      fixture.active++
      fixture.maximum = Math.max(fixture.maximum, fixture.active)
      try {
        await fixture.login()
        if (fixture.error) throw fixture.error
        this.user = { ...this.user, uid: fixture.uid, logged: fixture.logged }
        return fixture.logged ? '登录成功' : '密码错误'
      }
      finally { fixture.active-- }
    }
    getCookie() { return [] }
  },
}))

let account: any
let prisma: any
beforeEach(() => {
  fixture.uid = 'cx-a'
  fixture.logged = true
  fixture.error = undefined
  fixture.login.mockReset().mockResolvedValue(undefined)
  fixture.active = fixture.maximum = 0
  account = { uid: 'cx-a', userId: 'web-a', username: '13800000000', password: 'stored-fixture',
    cookies: [], info: { uid: 'cx-a', logged: false, password: 'hidden-fixture' },
    setting: { delay: 10 }, courses: [{ courseId: 'course', classId: 'class' }], lastLoginTime: new Date('2026-10-01') }
  prisma = { cxAccount: {
    findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.userId === 'web-a' ? account : null)),
    update: vi.fn().mockImplementation(({ data }: any) => { account = { ...account, ...data }; return Promise.resolve(account) }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  } }
  vi.stubGlobal('createError', (input: any) => Object.assign(new Error(input.message), input))
  vi.stubGlobal('defineEventHandler', (handler: any) => handler)
  vi.stubGlobal('readBody', (event: any) => Promise.resolve(event.body))
  vi.stubGlobal('ResOp', ResOp)
})
afterEach(async () => {
  const { CXMap } = await import('../server/protocol/cx')
  CXMap.clear()
  vi.unstubAllGlobals()
})

it('renews the original account with saved credentials and replaces the UID cache without losing data', async () => {
  const { renewCxAccount } = await import('../server/utils/cxSession')
  const { CXMap } = await import('../server/protocol/cx')
  CXMap.set('cx-a', { user: { uid: 'cx-a' } } as any)
  CXMap.set(account.username, { user: { uid: 'cx-a' } } as any)
  const result = await renewCxAccount(prisma, 'web-a', 'cx-a')
  expect(result).toMatchObject({ uid: 'cx-a', loginExpired: false, setting: { delay: 10 }, courses: account.courses })
  expect(result).not.toHaveProperty('password')
  expect(result).not.toHaveProperty('cookies')
  expect(result.info).not.toHaveProperty('password')
  expect(CXMap.get('cx-a')?.user.password).toBe('stored-fixture')
  expect(CXMap.get('cx-a')?.setting).toEqual(account.setting)
  expect(CXMap.has(account.username)).toBe(false)
})

it('updates the saved password only after successful manual authentication', async () => {
  const { renewCxAccount } = await import('../server/utils/cxSession')
  fixture.logged = false
  await expect(renewCxAccount(prisma, 'web-a', 'cx-a', 'new-fixture')).rejects.toMatchObject({ statusCode: 409 })
  expect(prisma.cxAccount.update).not.toHaveBeenCalled()
  fixture.logged = true
  await renewCxAccount(prisma, 'web-a', 'cx-a', 'new-fixture')
  expect(account.password).toBe('new-fixture')
})

it('rejects another owner before authentication and rejects a mismatched upstream UID', async () => {
  const { renewCxAccount } = await import('../server/utils/cxSession')
  await expect(renewCxAccount(prisma, 'web-b', 'cx-a')).rejects.toMatchObject({ statusCode: 404 })
  expect(fixture.login).not.toHaveBeenCalled()
  fixture.uid = 'other-account'
  await expect(renewCxAccount(prisma, 'web-a', 'cx-a')).rejects.toMatchObject({ statusCode: 409 })
  expect(prisma.cxAccount.update).not.toHaveBeenCalled()
})

it('serializes authentication attempts for one UID', async () => {
  const { renewCxAccount } = await import('../server/utils/cxSession')
  fixture.login.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5)))
  await Promise.all([renewCxAccount(prisma, 'web-a', 'cx-a'), renewCxAccount(prisma, 'web-a', 'cx-a')])
  expect(fixture.maximum).toBe(1)
})

it('persists expiry only for the current cached session and isolates owner notifications', async () => {
  const { bindCxSession, renewCxAccount } = await import('../server/utils/cxSession')
  const { CXMap, Cx } = await import('../server/protocol/cx')
  const { accountSessionBus } = await import('../server/utils/accountSessionBus')
  const own = vi.fn()
  const other = vi.fn()
  const closeOwn = accountSessionBus.subscribe('web-a', own)
  const closeOther = accountSessionBus.subscribe('web-b', other)
  try {
    const old = new Cx({ uid: 'cx-a' })
    bindCxSession(old, account, prisma)
    CXMap.set('cx-a', old)
    await old.onSessionExpired?.()
    expect(prisma.cxAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { uid: 'cx-a', userId: 'web-a', lastLoginTime: new Date('2026-10-01') },
    }))
    expect(own).toHaveBeenLastCalledWith(expect.objectContaining({ loginExpired: true }))
    expect(other).not.toHaveBeenCalled()
    await renewCxAccount(prisma, 'web-a', 'cx-a')
    prisma.cxAccount.updateMany.mockClear()
    own.mockClear()
    await old.onSessionExpired?.()
    expect(prisma.cxAccount.updateMany).not.toHaveBeenCalled()
    expect(own).not.toHaveBeenCalled()
  }
  finally { closeOwn(); closeOther() }
})

it('validates relogin requests and allows recovery without using the expired business context', async () => {
  const handler = (await import('../server/api/cx/accounts/[uid]/relogin.post')).default
  const event = (body: any, session: any = { uid: 'web-a' }) => ({ session, body, context: { params: { uid: 'cx-a' }, prisma } } as any)
  await expect(handler(event({ uid: 'cx-a', mode: 'saved' }, null))).rejects.toMatchObject({ statusCode: 401 })
  await expect(handler(event({ uid: 'cx-a', mode: 'manual', password: '' }))).rejects.toMatchObject({ statusCode: 400 })
  await expect(handler(event({ uid: 'cx-a', mode: 'saved' }))).resolves.toMatchObject({ code: 200, data: { uid: 'cx-a', loginExpired: false } })
})

it('does not let a background renewal recover an explicitly expired account', async () => {
  const { renewCxAccount } = await import('../server/utils/cxSession')
  const result = await renewCxAccount(prisma, 'web-a', 'cx-a', undefined, true)
  expect(result.loginExpired).toBe(true)
  expect(fixture.login).not.toHaveBeenCalled()
})

it('does not mutate course associations when course retrieval reports an expired session', async () => {
  const { CxSessionExpiredError } = await import('../server/protocol/cx/session')
  const handler = (await import('../server/api/cx/courses/index.get')).default
  const error = new CxSessionExpiredError('cx-a')
  const db = { course: { findMany: vi.fn(), createMany: vi.fn() }, cxAccount: { update: vi.fn() } }
  await expect(handler({ context: { cx: { getCourseList: vi.fn().mockRejectedValue(error) }, prisma: db } } as any)).rejects.toBe(error)
  expect(db.course.findMany).not.toHaveBeenCalled()
  expect(db.cxAccount.update).not.toHaveBeenCalled()
})

it('returns the persisted expiry flag on account refresh without background authentication', async () => {
  const handler = (await import('../server/api/cx/accounts/index.get')).default
  prisma.cxAccount.findMany = vi.fn().mockResolvedValue([account])
  const result = await handler({ session: { uid: 'web-a' }, context: { prisma } } as any)
  expect(result.data[0]).toMatchObject({ uid: 'cx-a', loginExpired: true })
  expect(result.data[0].info).not.toHaveProperty('password')
  expect(fixture.login).not.toHaveBeenCalled()
})

it('clears UID and legacy aliases on logout even after the instance clears its user info', async () => {
  const handler = (await import('../server/api/cx/logout.post')).default
  const { CXMap } = await import('../server/protocol/cx')
  const cx = { user: { uid: 'cx-a' } as any, async logout() { this.user = {} } }
  CXMap.set('cx-a', cx as any)
  CXMap.set('13800000000', cx as any)
  prisma.cxAccount.delete = vi.fn().mockResolvedValue(account)
  await handler({ context: { cx, prisma } } as any)
  expect(CXMap.size).toBe(0)
  expect(prisma.cxAccount.delete).toHaveBeenCalledWith({ where: { uid: 'cx-a' } })
})
