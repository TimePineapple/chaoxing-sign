import type { QrCoordinates } from '~/utils/qrLocation'
import { browserLocationToBaidu } from '~/server/utils/qrLocation'

interface BaiduReverseGeocodeResponse {
  status?: number
  result?: {
    formatted_address?: string
  }
}

export async function baiduReverseGeocode(location: QrCoordinates, ak: string, signal?: AbortSignal): Promise<string> {
  const url = new URL('https://api.map.baidu.com/reverse_geocoding/v3/')
  url.searchParams.set('ak', ak)
  url.searchParams.set('location', `${location.latitude},${location.longitude}`)
  url.searchParams.set('coordtype', 'bd09ll')
  url.searchParams.set('output', 'json')

  const response = await fetch(url, { signal })
  if (!response.ok)
    throw new Error('百度地图逆地理编码 HTTP 请求失败')

  const body = await response.json() as BaiduReverseGeocodeResponse
  const address = body.result?.formatted_address?.trim()
  if (body.status !== 0 || !address)
    throw new Error('百度地图逆地理编码未返回有效地址')
  return address
}

const EARTH_RADIUS_METERS = 6_371_008.8
const MAX_ADDRESS_DISTANCE_METERS = 30

function distanceMeters(a: QrCoordinates, b: QrCoordinates): number {
  const toRadians = Math.PI / 180
  const latitudeDelta = (b.latitude - a.latitude) * toRadians
  const longitudeDelta = (b.longitude - a.longitude) * toRadians
  const aLatitude = a.latitude * toRadians
  const bLatitude = b.latitude * toRadians
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(aLatitude) * Math.cos(bLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

export function createBaiduAddressCache(reverseGeocode = baiduReverseGeocode) {
  const entries: Array<{ location: QrCoordinates; address: Promise<string> }> = []

  return (clientLocation: QrCoordinates, ak: string): Promise<string> => {
    const existing = entries.find(entry => distanceMeters(entry.location, clientLocation) < MAX_ADDRESS_DISTANCE_METERS)
    if (existing)
      return existing.address

    // Cache by the unmodified browser position. Every account keeps its own later coordinate offset.
    const location = { ...clientLocation }
    const address = reverseGeocode(browserLocationToBaidu(location), ak, AbortSignal.timeout(10_000))
    const entry = { location, address }
    entries.push(entry)
    void address.catch(() => {
      const index = entries.indexOf(entry)
      if (index !== -1)
        entries.splice(index, 1)
    })
    return address
  }
}

export const getCachedBaiduAddress = createBaiduAddressCache()
