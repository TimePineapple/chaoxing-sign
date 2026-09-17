import { expect, it } from 'vitest'
import { CxRequestStartQueue } from './cxRequestStartQueue'

it('starts requests at least 200 ms apart', async () => {
  const queue = new CxRequestStartQueue()
  const started: number[] = []
  const first = queue.waitTurn().then(() => started.push(Date.now()))
  const second = queue.waitTurn().then(() => started.push(Date.now()))
  const third = queue.waitTurn().then(() => started.push(Date.now()))
  await Promise.all([first, second, third])
  expect(started).toHaveLength(3)
  expect(started[1] - started[0]).toBeGreaterThanOrEqual(190)
  expect(started[2] - started[1]).toBeGreaterThanOrEqual(190)
})
