import { expect, it } from 'vitest'
import { CX_REQUEST_INTERVAL_MAX_MS, CX_REQUEST_INTERVAL_MIN_MS, randomCxRequestIntervalMs } from './cxRequestInterval'
import { CxRequestStartQueue } from './cxRequestStartQueue'

it('samples integer intervals from 30 through 100 milliseconds', () => {
  const intervals = Array.from({ length: 1_000 }, () => randomCxRequestIntervalMs())
  expect(intervals.every(interval => Number.isInteger(interval)
    && interval >= CX_REQUEST_INTERVAL_MIN_MS
    && interval <= CX_REQUEST_INTERVAL_MAX_MS)).toBe(true)
})

it('supports a separately sampled interval before each following request', async () => {
  const intervals = [30, 100]
  const queue = new CxRequestStartQueue(() => intervals.shift() ?? 30)
  const started: number[] = []
  const first = queue.waitTurn().then(() => started.push(Date.now()))
  const second = queue.waitTurn().then(() => started.push(Date.now()))
  const third = queue.waitTurn().then(() => started.push(Date.now()))
  await Promise.all([first, second, third])
  expect(started).toHaveLength(3)
  expect(started[1] - started[0]).toBeGreaterThanOrEqual(25)
  expect(started[2] - started[1]).toBeGreaterThanOrEqual(95)
})
