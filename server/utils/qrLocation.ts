import type { QrCoordinates } from '~/utils/qrLocation'

const EARTH_RADIUS_METERS = 6_371_008.8
const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const X_PI = Math.PI * 3000 / 180

export function offsetQrLocation(base: QrCoordinates, random = Math.random): QrCoordinates {
  const distance = 6 * Math.sqrt(random())
  const bearing = 2 * Math.PI * random()
  const angularDistance = distance / EARTH_RADIUS_METERS
  const latitude = base.latitude * DEG_TO_RAD
  const longitude = base.longitude * DEG_TO_RAD
  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
    + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const nextLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude),
  )
  return {
    latitude: nextLatitude * RAD_TO_DEG,
    longitude: ((nextLongitude * RAD_TO_DEG + 540) % 360) - 180,
  }
}

function outsideChina({ latitude, longitude }: QrCoordinates): boolean {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271
}

function transformLatitude(x: number, y: number): number {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  value += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
  value += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3
  value += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3
  return value
}

function transformLongitude(x: number, y: number): number {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  value += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
  value += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3
  value += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3
  return value
}

export function browserLocationToBaidu(base: QrCoordinates): QrCoordinates {
  if (outsideChina(base))
    return base

  const x = base.longitude - 105
  const y = base.latitude - 35
  const latitudeRadians = base.latitude * DEG_TO_RAD
  const sinLatitude = Math.sin(latitudeRadians)
  const magic = 1 - 0.00669342162296594323 * sinLatitude * sinLatitude
  const sqrtMagic = Math.sqrt(magic)
  const gcjLatitude = base.latitude + transformLatitude(x, y) * 180
    / ((6_378_245 * (1 - 0.00669342162296594323)) / (magic * sqrtMagic) * Math.PI)
  const gcjLongitude = base.longitude + transformLongitude(x, y) * 180
    / (6_378_245 / sqrtMagic * Math.cos(latitudeRadians) * Math.PI)
  const radius = Math.hypot(gcjLongitude, gcjLatitude)
    + 0.00002 * Math.sin(gcjLatitude * X_PI)
  const angle = Math.atan2(gcjLatitude, gcjLongitude)
    + 0.000003 * Math.cos(gcjLongitude * X_PI)
  return {
    latitude: radius * Math.sin(angle) + 0.006,
    longitude: radius * Math.cos(angle) + 0.0065,
  }
}
