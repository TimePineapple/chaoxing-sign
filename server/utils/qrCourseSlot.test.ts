import { describe, expect, it } from 'vitest'
import { resolveQrCourseSlot } from './qrCourseSlot'

describe('resolveQrCourseSlot', () => {
  it.each([
    ['2026-09-21T23:29:00.000Z', null], // Beijing Tuesday 07:29
    ['2026-09-21T23:30:00.000Z', { weekday: 2, slotStartMinute: 450 }],
    ['2026-09-22T00:29:59.000Z', { weekday: 2, slotStartMinute: 450 }],
    ['2026-09-22T00:30:00.000Z', { weekday: 2, slotStartMinute: 510 }],
    ['2026-09-22T13:29:59.000Z', { weekday: 2, slotStartMinute: 1230 }],
    ['2026-09-22T13:30:00.000Z', null],
  ])('maps %s using Beijing time', (timestamp, expected) => {
    expect(resolveQrCourseSlot(new Date(timestamp))).toEqual(expected)
  })

  it('keeps the same clock slot separate across weekdays', () => {
    expect(resolveQrCourseSlot(new Date('2026-09-21T23:30:00.000Z'))).toEqual({ weekday: 2, slotStartMinute: 450 })
    expect(resolveQrCourseSlot(new Date('2026-09-22T23:30:00.000Z'))).toEqual({ weekday: 3, slotStartMinute: 450 })
  })
})
