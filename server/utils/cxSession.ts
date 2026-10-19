import type { CxAccount, PrismaClient } from '@prisma/client'
import { CXMap, Cx } from '~/server/protocol/cx'
import { accountSessionBus } from './accountSessionBus'

const locks = new Map<string, Promise<unknown>>()

export async function withCxAccountLock<T>(uid: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(uid) || Promise.resolve()
  const current = previous.catch(() => {}).then(run)
  locks.set(uid, current)
  try { return await current }
  finally {
    if (locks.get(uid) === current)
      locks.delete(uid)
  }
}

export function publicCxAccount<T extends { info: unknown; lastLoginTime: Date | string }>(account: T) {
  const { password: _password, cookies: _cookies, ...safe } = account as T & { password?: unknown; cookies?: unknown }
  const { password: _infoPassword, ...info } = (account.info || {}) as Record<string, unknown>
  return { ...safe, info: info as unknown as Omit<CX.User, 'password'>, loginExpired: info.logged === false,
    lastLoginTime: new Date(account.lastLoginTime).toISOString() }
}

export function bindCxSession(cx: Cx, account: CxAccount, prisma: PrismaClient) {
  let persistedExpired = false
  cx.setting = account.setting as unknown as CX.Setting
  cx.sessionLoginTime = account.lastLoginTime.toISOString()
  cx.onSessionExpired = () => withCxAccountLock(String(account.uid), async () => {
    if (persistedExpired || CXMap.get(String(account.uid)) !== cx)
      return
    const info = { ...(account.info as Record<string, unknown>), logged: false }
    const updated = await prisma.cxAccount.updateMany({
      where: { uid: account.uid, userId: account.userId, lastLoginTime: account.lastLoginTime },
      data: { info },
    })
    if (updated.count) {
      persistedExpired = true
      accountSessionBus.publish(account.userId, {
        uid: String(account.uid), loginExpired: true, lastLoginTime: cx.sessionLoginTime!,
      })
    }
  })
}

export function installCxSession(cx: Cx, account: CxAccount, prisma: PrismaClient) {
  bindCxSession(cx, account, prisma)
  const legacy = CXMap.get(account.username)
  if (account.username !== String(account.uid) && legacy?.user.uid === account.uid)
    CXMap.delete(account.username)
  CXMap.set(String(account.uid), cx)
  accountSessionBus.publish(account.userId, {
    uid: String(account.uid), loginExpired: false, lastLoginTime: cx.sessionLoginTime!,
  })
}

export async function renewCxAccount(prisma: PrismaClient, ownerId: string, uid: string, password?: string, background = false) {
  return withCxAccountLock(uid, async () => {
    const account = await prisma.cxAccount.findFirst({ where: { uid, userId: ownerId }, include: { courses: true } })
    if (!account)
      throw createError({ statusCode: 404, message: '学习通账号不存在' })
    if (background && (account.info as unknown as CX.User)?.logged === false)
      return publicCxAccount(account)
    const cx = new Cx({ username: account.username, password: password ?? account.password })
    const result = await cx.login()
    if (!cx.user.logged)
      throw createError({ statusCode: 409, message: result || '重新登录失败，请检查账号密码' })
    if (String(cx.user.uid) !== uid)
      throw createError({ statusCode: 409, message: '登录返回的账号与目标账号不一致' })
    const lastLoginTime = new Date(Math.max(Date.now(), account.lastLoginTime.getTime() + 1))
    const updated = await prisma.cxAccount.update({
      where: { uid },
      data: { info: cx.user as any, cookies: cx.getCookie('', 'json') as any,
        lastLoginTime, ...(password !== undefined ? { password } : {}) },
      include: { courses: true },
    })
    cx.courseList = account.courses as unknown as CX.Course[]
    installCxSession(cx, updated, prisma)
    return publicCxAccount(updated)
  })
}
