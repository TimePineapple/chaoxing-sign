import dayjs from 'dayjs'
import { publicCxAccount, renewCxAccount } from '~/server/utils/cxSession'
import { getServerSession } from '#auth'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)!
  if (!session?.uid)
    throw createError({ statusCode: 401, message: '网站登录已过期，请重新登录' })

  const accounts = await event.context.prisma.cxAccount.findMany({
    where: {
      userId: session!.uid,
    },
    select: {
      uid: true,
      userId: true,
      cookies: true,
      username: true,
      password: true,
      info: true,
      courses: true,
      setting: true,
      lastLoginTime: true,
      signlogs: true,
    },
    orderBy: {
      lastLoginTime: 'asc',
    },
  })

  // 已确认失效的账号只能由用户主动恢复。
  const toReLoginAccounts = accounts.filter((account) => {
    return (account.info as unknown as CX.User)?.logged !== false && dayjs(account.lastLoginTime)
      .add(7, 'day')
      .isBefore(dayjs())
  })

  for await (const account of toReLoginAccounts) {
    try {
      const renewed = await renewCxAccount(event.context.prisma, session!.uid, account.uid, undefined, true)
      Object.assign(account, renewed)
    }
    catch { /* A failed background renewal must not hide the account list. */ }
  }

  const data = accounts.map((account) => {
    return publicCxAccount(account)
  })

  return ResOp.success(data)
})
