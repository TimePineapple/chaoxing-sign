import type { QrJobView, QrStreamSnapshot } from './qrSignProtocol'

export type QrSignOverlayMode = 'none' | 'waiting' | 'completed'
const RECENT_SUCCESS_MS = 60_000

export class QrSignOverlayTracker {
  private readonly active = new Map<string, QrJobView>()
  private readonly recentSuccess = new Map<string, QrJobView>()

  reset() {
    this.active.clear()
    this.recentSuccess.clear()
  }

  applySnapshot(snapshot: QrStreamSnapshot, now = Date.now()) {
    this.reset()
    for (const job of snapshot.active) {
      if (job.state === 'queued' || job.state === 'running')
        this.active.set(job.uid, job)
    }
    for (const job of snapshot.recentSuccess)
      this.addSuccess(job, now)
  }

  applyJob(job: QrJobView, now = Date.now()) {
    if (job.state === 'queued' || job.state === 'running')
      this.active.set(job.uid, job)
    else {
      if (this.active.get(job.uid)?.id === job.id)
        this.active.delete(job.uid)
      if (job.state === 'success')
        this.addSuccess(job, now)
    }
    this.prune(now)
  }

  private addSuccess(job: QrJobView, now: number) {
    if (job.state === 'success' && job.completedAt !== undefined
      && job.completedAt + RECENT_SUCCESS_MS > now)
      this.recentSuccess.set(job.id, job)
  }

  prune(now = Date.now()) {
    for (const [id, job] of this.recentSuccess) {
      if (job.completedAt === undefined || job.completedAt + RECENT_SUCCESS_MS <= now)
        this.recentSuccess.delete(id)
    }
  }

  nextExpiry(now = Date.now()): number | null {
    this.prune(now)
    const expiries = [...this.recentSuccess.values()]
      .map(job => (job.completedAt ?? 0) + RECENT_SUCCESS_MS)
    return expiries.length ? Math.min(...expiries) : null
  }

  mode(selectedUids: readonly string[], clientId: string, now = Date.now()): QrSignOverlayMode {
    if (selectedUids.length === 0)
      return 'none'
    const selectedActive = selectedUids
      .map(uid => this.active.get(uid))
      .filter((job): job is QrJobView => Boolean(job))
    if (selectedActive.some(job => Boolean(job.clientId) && job.clientId !== clientId))
      return 'waiting'
    if (selectedActive.length > 0)
      return 'none'
    this.prune(now)
    return selectedUids.every(uid => [...this.recentSuccess.values()].some(job =>
      job.uid === uid && Boolean(job.clientId) && job.clientId !== clientId))
      ? 'completed' : 'none'
  }
}
