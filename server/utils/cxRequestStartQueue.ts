import { setTimeout as delay } from 'node:timers/promises'

export class CxRequestStartQueue {
  private nextStart = 0
  private tail = Promise.resolve()

  constructor(private readonly intervalMs = 200) {}

  async waitTurn(signal?: AbortSignal) {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      if (signal?.aborted)
        throw signal.reason || new Error('Request aborted')
      const waitMs = Math.max(0, this.nextStart - Date.now())
      if (waitMs)
        await delay(waitMs, undefined, { signal })
      if (signal?.aborted)
        throw signal.reason || new Error('Request aborted')
      this.nextStart = Date.now() + this.intervalMs
    }
    finally {
      release()
    }
  }
}

export const cxRequestStartQueue = new CxRequestStartQueue()
