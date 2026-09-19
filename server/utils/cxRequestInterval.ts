import { randomInt } from 'node:crypto'

export const CX_REQUEST_INTERVAL_MIN_MS = 30
export const CX_REQUEST_INTERVAL_MAX_MS = 100

export function randomCxRequestIntervalMs() {
  return randomInt(CX_REQUEST_INTERVAL_MIN_MS, CX_REQUEST_INTERVAL_MAX_MS + 1)
}
