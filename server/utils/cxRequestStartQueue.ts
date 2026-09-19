import { setTimeout as delay } from 'node:timers/promises'
import { randomCxRequestIntervalMs } from './cxRequestInterval'

type IntervalSource = number | (() => number)

export class CxRequestStartQueue {
  private nextStart = 0
  private tail = Promise.resolve()

  constructor(private readonly intervalSource: IntervalSource = randomCxRequestIntervalMs) {}

  private nextIntervalMs() {
    return typeof this.intervalSource === 'function' ? this.intervalSource() : this.intervalSource
  }

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
      this.nextStart = Date.now() + this.nextIntervalMs()
    }
    finally {
      release()
    }
  }
}

export const cxRequestStartQueue = new CxRequestStartQueue()
