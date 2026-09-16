import { randomUUID } from 'node:crypto'
import type { QrJobEvent, QrJobView, QrStreamSnapshot, QrSubmitDecision } from '~/utils/qrSignProtocol'

interface Job extends QrJobView {
  ownerId: string
  run: (signal: AbortSignal) => Promise<{ result: string; activityName?: string }>
}

interface SubmitInput {
  ownerId: string
  uid: string
  activityId: string
  run: Job['run']
}

const TIMEOUT_MESSAGE = '等待签到响应超时，结果尚未确认；请先核对签到历史再决定是否重试'

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
  private readonly listeners = new Map<string, Set<(event: QrJobEvent) => void>>()
  private sequence = 0
  private lastStartedAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly intervalMs = 200, private readonly timeoutMs = 45_000) {}

  private prune() {
    const now = Date.now()
    while (this.history.length && this.history[0].expiresAt <= now)
      this.history.shift()
  }

  private view(job: QrJobView): QrJobView {
    return { id: job.id, uid: job.uid, activityId: job.activityId, state: job.state,
      message: safeText(job.message) || '', result: safeText(job.result), activityName: safeText(job.activityName) }
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
    const waitMs = Math.max(0, this.lastStartedAt + this.intervalMs - Date.now())
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
      const outcome = await Promise.race([job.run(controller.signal), deadline])
      job.result = outcome.result
      job.activityName = outcome.activityName
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
      this.publish(job)
    }
  }

  snapshot(ownerId: string): QrStreamSnapshot {
    this.prune()
    return {
      active: [...this.active.values()].filter(job => job.ownerId === ownerId).map(job => this.view(job)),
    }
  }

  replay(ownerId: string, afterSequence: number): QrJobEvent[] {
    this.prune()
    return this.history.filter(item => item.ownerId === ownerId && item.event.sequence > afterSequence)
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
