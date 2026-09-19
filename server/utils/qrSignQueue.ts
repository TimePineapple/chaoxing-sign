import { randomUUID } from 'node:crypto'
import type { QrJobEvent, QrJobView, QrStreamSnapshot, QrSubmitDecision } from '~/utils/qrSignProtocol'
import { randomCxRequestIntervalMs } from './cxRequestInterval'

type IntervalSource = number | (() => number)

interface Job extends QrJobView {
  ownerId: string
  run: (signal: AbortSignal, reportCourseName: (name: string) => void) => Promise<{ result: string; activityName?: string; courseName?: string }>
}

interface SubmitInput {
  ownerId: string
  uid: string
  activityId: string
  clientId?: string
  run: Job['run']
}

const TIMEOUT_MESSAGE = '等待签到响应超时，结果尚未确认；请先核对签到历史再决定是否重试'
const RECENT_SUCCESS_MS = 60_000

function safeText(value?: string) {
  if (!value)
    return value
  return value.slice(0, 500)
    .replace(/https?:\/\/\S+/gi, '[链接已隐藏]')
    .replace(/\b(enc|cookie|set-cookie|password)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&,}]+)/gi, '$1=[已隐藏]')
}

export class QrSignQueue {
  private readonly active = new Map<string, Job>()
  private readonly waiting: Job[] = []
  private readonly history: Array<{ ownerId: string; event: QrJobEvent; expiresAt: number }> = []
  private readonly recentSuccess = new Map<string, { ownerId: string; view: QrJobView }>()
  private readonly listeners = new Map<string, Set<(event: QrJobEvent) => void>>()
  private sequence = 0
  private lastStartedAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly intervalSource: IntervalSource = randomCxRequestIntervalMs, private readonly timeoutMs = 45_000) {}

  private nextIntervalMs() {
    return typeof this.intervalSource === 'function' ? this.intervalSource() : this.intervalSource
  }

  private prune() {
    const now = Date.now()
    while (this.history.length && this.history[0].expiresAt <= now)
      this.history.shift()
    for (const [id, item] of this.recentSuccess) {
      if (!item.view.completedAt || item.view.completedAt + RECENT_SUCCESS_MS <= now)
        this.recentSuccess.delete(id)
    }
  }

  private view(job: QrJobView): QrJobView {
    return { id: job.id, uid: job.uid, activityId: job.activityId, clientId: job.clientId,
      submittedAt: job.submittedAt, completedAt: job.completedAt, state: job.state,
      message: safeText(job.message) || '', result: safeText(job.result),
      activityName: safeText(job.activityName), courseName: safeText(job.courseName) }
  }

  private publish(job: Job) {
    this.prune()
    const event: QrJobEvent = { ...this.view(job), sequence: ++this.sequence }
    this.history.push({ ownerId: job.ownerId, event, expiresAt: Date.now() + 60_000 })
    for (const listener of this.listeners.get(job.ownerId) || []) {
      try { listener(event) }
      catch { /* A disconnected browser cannot interrupt the job. */ }
    }
  }

  submit(input: SubmitInput): QrSubmitDecision {
    this.prune()
    const running = this.active.get(input.uid)
    if (running)
      return { state: 'busy', job: this.view(running) }

    const job: Job = {
      id: randomUUID(), uid: input.uid, ownerId: input.ownerId,
      clientId: input.clientId, submittedAt: Date.now(),
      activityId: input.activityId, state: 'queued', message: '已进入服务器扫码队列',
      run: input.run,
    }
    // Claim synchronously before scheduling so concurrent requests cannot both enter.
    this.active.set(input.uid, job)
    this.waiting.push(job)
    this.publish(job)
    this.schedule()
    return { state: 'accepted', job: this.view(job) }
  }

  private schedule() {
    if (this.timer || !this.waiting.length)
      return
    const waitMs = this.lastStartedAt
      ? Math.max(0, this.lastStartedAt + this.nextIntervalMs() - Date.now())
      : 0
    this.timer = setTimeout(() => {
      this.timer = undefined
      const job = this.waiting.shift()
      if (!job)
        return
      this.lastStartedAt = Date.now()
      job.state = 'running'
      job.message = '正在访问学习通，等待结果（最多45秒）'
      this.publish(job)
      void this.execute(job)
      this.schedule()
    }, waitMs)
  }

  private async execute(job: Job) {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new Error('QR_TASK_TIMEOUT'))
      }, this.timeoutMs)
    })
    try {
      const outcome = await Promise.race([job.run(controller.signal, (name) => {
        const courseName = name.trim()
        if (!courseName || job.state === 'error' || (job.completedAt && job.completedAt + RECENT_SUCCESS_MS <= Date.now()))
          return
        if (job.courseName !== courseName) {
          job.courseName = courseName
          if (job.state === 'success' && this.recentSuccess.has(job.id)) {
            this.recentSuccess.set(job.id, { ownerId: job.ownerId, view: this.view(job) })
            this.publish(job)
          }
        }
      }), deadline])
      job.result = outcome.result
      job.activityName = outcome.activityName
      job.courseName = job.courseName || outcome.courseName
      job.state = outcome.result === '签到成功' ? 'success' : 'error'
      job.message = outcome.result
    }
    catch (error) {
      const failure = error as { code?: string; message?: string; publicMessage?: string }
      const code = failure?.message === 'QR_TASK_TIMEOUT' ? 'QR_TASK_TIMEOUT'
        : typeof failure?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(failure.code)
          ? failure.code : 'UNKNOWN_ERROR'
      job.state = 'error'
      job.message = failure?.message === 'QR_TASK_TIMEOUT'
        ? TIMEOUT_MESSAGE
        : failure?.publicMessage || `扫码失败（${code}），请查看服务端日志`
      console.warn(`[qr-code-sign][${job.id}] task failed`, { code })
    }
    finally {
      if (timeout)
        clearTimeout(timeout)
      this.active.delete(job.uid)
      job.completedAt = Date.now()
      if (job.state === 'success')
        this.recentSuccess.set(job.id, { ownerId: job.ownerId, view: this.view(job) })
      this.publish(job)
    }
  }

  snapshot(ownerId: string): QrStreamSnapshot {
    this.prune()
    return {
      active: [...this.active.values()].filter(job => job.ownerId === ownerId).map(job => this.view(job)),
      recentSuccess: [...this.recentSuccess.values()]
        .filter(item => item.ownerId === ownerId)
        .map(item => item.view),
    }
  }

  replay(ownerId: string, afterSequence: number): QrJobEvent[] {
    this.prune()
    return this.history.filter(item => item.ownerId === ownerId && item.event.sequence > afterSequence
      && (item.event.state !== 'success' || !item.event.completedAt
        || item.event.completedAt + RECENT_SUCCESS_MS > Date.now()))
      .map(item => item.event)
  }

  subscribe(ownerId: string, listener: (event: QrJobEvent) => void) {
    let listeners = this.listeners.get(ownerId)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(ownerId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0)
        this.listeners.delete(ownerId)
    }
  }
}

export const qrSignQueue = new QrSignQueue()
