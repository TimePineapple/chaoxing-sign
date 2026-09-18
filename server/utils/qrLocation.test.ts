import { describe, expect, it } from 'vitest'
import { browserLocationToBaidu, offsetQrLocation } from './qrLocation'

const base = { latitude: 39.908823, longitude: 116.39747 }

function distanceMeters(a: typeof base, b: typeof base): number {
  const rad = Math.PI / 180
  const latitudeDelta = (b.latitude - a.latitude) * rad
  const longitudeDelta = (b.longitude - a.longitude) * rad
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(haversine))
}

describe('QR position offset', () => {
  it('keeps offsets inside six meters, including the outer boundary', () => {
    for (const radiusFraction of [0, 0.01, 0.25, 0.5, 0.99, 1]) {
      for (const angleFraction of [0, 0.125, 0.5, 0.875]) {
        const values = [radiusFraction, angleFraction]
        const position = offsetQrLocation(base, () => values.shift()!)
        expect(distanceMeters(base, position)).toBeLessThanOrEqual(6.001)
      }
    }
    const values = [1, 0]
    expect(distanceMeters(base, offsetQrLocation(base, () => values.shift()!))).toBeCloseTo(6, 3)
  })

  it('converts a China browser position and leaves an overseas position unchanged', () => {
    const converted = browserLocationToBaidu(base)
    expect(converted.latitude).toBeGreaterThan(base.latitude)
    expect(converted.longitude).toBeGreaterThan(base.longitude)
    const overseas = { latitude: 40.7128, longitude: -74.006 }
    expect(browserLocationToBaidu(overseas)).toEqual(overseas)
  })
})
