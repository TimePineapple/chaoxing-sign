import { omit } from 'lodash-es'
import { getServerSession } from '#auth'
import { CXMap, Cx, CxLoginError } from '~~/server/protocol/cx'
import { CxProxyError } from '~~/server/protocol/cx/proxy'
import { defaultSetting } from '~/constants/setting'

export interface Body extends Pick<CX.User, 'username' | 'password'> { }

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.uid)
    throw createError({ statusCode: 401, message: '网站登录已过期，请重新登录' })

  const body = await readBody<Body>(event)

  let cx: Cx
  let result: string | null
  try {
    cx = new Cx(body)
    result = await cx.login()
  }
  catch (error) {
    if (error instanceof CxLoginError || error instanceof CxProxyError)
      throw createError({ statusCode: 502, message: error.message })
    throw error
  }

  if (!cx.user.logged)
    return new ResOp(201, null, result!)

  const updated = await event.context.prisma.cxAccount.updateMany({
    where: { uid: cx.user.uid, userId: session.uid },
    data: {
      cookies: cx.getCookie('', 'json'),
      info: cx.user as any,
      lastLoginTime: new Date(),
    },
  })
  let account
  if (updated.count) {
    account = await event.context.prisma.cxAccount.findUniqueOrThrow({ where: { uid: cx.user.uid } })
  }
  else {
    try {
      account = await event.context.prisma.cxAccount.create({ data: {
        uid: cx.user.uid,
        username: cx.user.username,
        password: cx.user.password,
        info: cx.user as any,
        cookies: cx.getCookie('', 'json'),
        setting: defaultSetting as any,
        lastLoginTime: new Date(),
        userId: session.uid,
      } })
    }
    catch (error) {
      if ((error as { code?: string })?.code !== 'P2002')
        throw error
      const ownUpdate = await event.context.prisma.cxAccount.updateMany({
        where: { uid: cx.user.uid, userId: session.uid },
        data: { cookies: cx.getCookie('', 'json'), info: cx.user as any, lastLoginTime: new Date() },
      })
      if (!ownUpdate.count)
        throw createError({ statusCode: 409, message: '该学习通账号已绑定到其他网页账号' })
      account = await event.context.prisma.cxAccount.findUniqueOrThrow({ where: { uid: cx.user.uid } })
    }
  }
  CXMap.set(cx.user.uid, cx)

  const data = {
    ...omit(account, 'password'),
    info: {
      ...omit(cx.user, 'password'),
    },
    lastLoginTime: account.lastLoginTime.toISOString(),
  }

  return ResOp.success(data, '登录成功')
})
