import { createEventStream } from 'h3'
import { getServerSession } from '#auth'
import { recentSignBus } from '~/server/utils/recentSignBus'
import { accountSessionBus } from '~/server/utils/accountSessionBus'
import type { AccountSessionEvent } from '~/types/accountSession'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.uid)
    throw createError({ statusCode: 401, message: '网站登录已过期，请重新登录' })

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Accel-Buffering', 'no')
  const stream = createEventStream(event)
  let sending = Promise.resolve()
  let ready = false
  const pending: AccountSessionEvent[] = []
  const sendSession = (state: AccountSessionEvent) => {
    sending = sending.then(() => stream.push({ event: 'account-session', data: JSON.stringify(state) }))
      .then(() => undefined).catch(() => undefined)
  }
  const unsubscribeSession = accountSessionBus.subscribe(session.uid, (state) => {
    if (ready)
      sendSession(state)
    else
      pending.push(state)
  })
  const unsubscribe = recentSignBus.subscribe(session.uid, (sign) => {
    sending = sending.then(() => stream.push({ event: 'sign', data: JSON.stringify(sign) }))
      .then(() => undefined).catch(() => undefined)
  })
  const heartbeat = setInterval(() => {
    sending = sending.then(() => stream.push({ event: 'heartbeat', data: '{}' }))
      .then(() => undefined).catch(() => undefined)
  }, 15_000)
  stream.onClosed(() => {
    clearInterval(heartbeat)
    unsubscribe()
    unsubscribeSession()
  })
  try {
    const accounts = await event.context.prisma.cxAccount.findMany({
      where: { userId: session.uid }, select: { uid: true, info: true, lastLoginTime: true },
    })
    for (const account of accounts) {
      sendSession({ uid: account.uid, loginExpired: (account.info as unknown as CX.User)?.logged === false,
        lastLoginTime: account.lastLoginTime.toISOString() })
    }
    ready = true
    for (const state of pending)
      sendSession(state)
  }
  catch {
    ready = true
    for (const state of pending)
      sendSession(state)
    // Account-list refresh remains the fallback if the initial snapshot is unavailable.
  }
  return stream.send()
})
