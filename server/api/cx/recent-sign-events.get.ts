import { createEventStream } from 'h3'
import { getServerSession } from '#auth'
import { recentSignBus } from '~/server/utils/recentSignBus'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.uid)
    throw createError({ statusCode: 401, message: '网站登录已过期，请重新登录' })

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Accel-Buffering', 'no')
  const stream = createEventStream(event)
  let sending = Promise.resolve()
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
  })
  return stream.send()
})
