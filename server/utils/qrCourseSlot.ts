export interface QrCourseSlot {
  weekday: number
  slotStartMinute: number
}

const SLOT_START_MINUTE = 7 * 60 + 30
const SLOT_END_MINUTE = 21 * 60 + 30
const SLOT_LENGTH_MINUTES = 60

const weekdayNumbers: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

const beijingDateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function resolveQrCourseSlot(now = new Date()): QrCourseSlot | null {
  const parts = Object.fromEntries(beijingDateTime.formatToParts(now).map(part => [part.type, part.value]))
  const weekday = weekdayNumbers[parts.weekday]
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const minuteOfDay = hour * 60 + minute

  if (!weekday || !Number.isInteger(hour) || !Number.isInteger(minute)
    || minuteOfDay < SLOT_START_MINUTE || minuteOfDay >= SLOT_END_MINUTE)
    return null

  return {
    weekday,
    slotStartMinute: SLOT_START_MINUTE
      + Math.floor((minuteOfDay - SLOT_START_MINUTE) / SLOT_LENGTH_MINUTES) * SLOT_LENGTH_MINUTES,
  }
}
