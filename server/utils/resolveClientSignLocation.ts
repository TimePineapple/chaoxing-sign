import type { QrCoordinates } from '~/utils/qrLocation'
import { getCachedBaiduAddress } from '~/server/utils/baiduReverseGeocode'
import { browserLocationToBaidu, offsetQrLocation } from '~/server/utils/qrLocation'

export async function resolveClientSignLocation(source: QrCoordinates) {
  const ak = process.env.BAIDU_MAP_SERVER_AK?.trim()
  if (!ak)
    throw new Error('未配置百度地图服务端 AK，无法获取签到地址')

  const coordinates = browserLocationToBaidu(offsetQrLocation(source))
  const address = await getCachedBaiduAddress(source, ak)
  return {
    text: address,
    latitude: coordinates.latitude.toFixed(6),
    longitude: coordinates.longitude.toFixed(6),
  }
}
