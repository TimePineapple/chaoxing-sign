export interface QrCoordinates {
  latitude: number
  longitude: number
}

export function isQrCoordinates(value: unknown): value is QrCoordinates {
  if (!value || typeof value !== 'object')
    return false

  const coordinates = value as Record<string, unknown>
  return typeof coordinates.latitude === 'number'
    && Number.isFinite(coordinates.latitude)
    && coordinates.latitude >= -90
    && coordinates.latitude <= 90
    && typeof coordinates.longitude === 'number'
    && Number.isFinite(coordinates.longitude)
    && coordinates.longitude >= -180
    && coordinates.longitude <= 180
}
