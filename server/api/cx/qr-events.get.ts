import { createEventStream } from 'h3'
import { getServerSession } from '#auth'
import { qrSignQueue } from '~/server/utils/qrSignQueue'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.uid)
    throw createError({ statusCode: 401, message: '网站登录已过期，请重新登录' })

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Accel-Buffering', 'no')
  const stream = createEventStream(event)
  let sending = Promise.resolve()
  const enqueue = (message: { id?: string; event: string; data: string }) => {
    sending = sending.then(() => stream.push(message)).then(() => undefined).catch(() => undefined)
  }
  let lastSentSequence = 0
  const sendJob = (job: ReturnType<typeof qrSignQueue.replay>[number]) => {
    if (job.sequence <= lastSentSequence)
      return
    lastSentSequence = job.sequence
    enqueue({ id: String(job.sequence), event: 'job', data: JSON.stringify(job) })
  }
  const pending: ReturnType<typeof qrSignQueue.replay> = []
  let ready = false
  const unsubscribe = qrSignQueue.subscribe(session.uid, (job) => {
    if (ready)
      sendJob(job)
    else
      pending.push(job)
  })
  const lastId = Number(getHeader(event, 'last-event-id') || 0)
  if (Number.isSafeInteger(lastId) && lastId > 0) {
    for (const job of qrSignQueue.replay(session.uid, lastId))
      sendJob(job)
  }
  enqueue({ event: 'snapshot', data: JSON.stringify(qrSignQueue.snapshot(session.uid)) })
  ready = true
  for (const job of pending.sort((a, b) => a.sequence - b.sequence))
    sendJob(job)
  const heartbeat = setInterval(() => {
    enqueue({ event: 'heartbeat', data: '{}' })
  }, 15_000)
  stream.onClosed(() => {
    clearInterval(heartbeat)
    unsubscribe()
  })
  return stream.send()
})
