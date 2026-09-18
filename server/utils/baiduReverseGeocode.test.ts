import { afterEach, describe, expect, it, vi } from 'vitest'
import { baiduReverseGeocode, createBaiduAddressCache } from './baiduReverseGeocode'
import { browserLocationToBaidu } from './qrLocation'

afterEach(() => vi.unstubAllGlobals())

describe('Baidu reverse geocoding for QR sign', () => {
  it('uses the outgoing BD-09 coordinates and returns the structured address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 0, result: { formatted_address: ' 北京市海淀区某路 ' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await baiduReverseGeocode({ latitude: 39.9165, longitude: 116.4101 }, 'fixture-ak')).toBe('北京市海淀区某路')
    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.origin).toBe('https://api.map.baidu.com')
    expect(url.pathname).toBe('/reverse_geocoding/v3/')
    expect(url.searchParams.get('location')).toBe('39.9165,116.4101')
    expect(url.searchParams.get('coordtype')).toBe('bd09ll')
    expect(url.searchParams.get('output')).toBe('json')
  })

  it('rejects an unsuccessful or empty address response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 240, result: {} }),
    }))
    await expect(baiduReverseGeocode({ latitude: 39.9165, longitude: 116.4101 }, 'fixture-ak'))
      .rejects.toThrow('未返回有效地址')
  })

  it('shares one lookup for the same or nearby client location, including concurrent calls', async () => {
    let resolveAddress!: (address: string) => void
    const firstResponse = new Promise<string>(resolve => { resolveAddress = resolve })
    const reverseGeocode = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValue('另一处地址')
    const getAddress = createBaiduAddressCache(reverseGeocode)
    const original = { latitude: 39.9165, longitude: 116.4101 }
    const nearby = { latitude: 39.91676, longitude: 116.4101 } // about 29 m
    const far = { latitude: 39.91678, longitude: 116.4101 } // about 31 m

    const first = getAddress(original, 'fixture-ak')
    expect(getAddress(original, 'fixture-ak')).toBe(first)
    expect(getAddress(nearby, 'fixture-ak')).toBe(first)
    expect(reverseGeocode).toHaveBeenCalledTimes(1)
    expect(reverseGeocode.mock.calls[0][0]).toEqual(browserLocationToBaidu(original))

    resolveAddress('共享地址')
    expect(await first).toBe('共享地址')
    expect(await getAddress(nearby, 'fixture-ak')).toBe('共享地址')
    expect(await getAddress(far, 'fixture-ak')).toBe('另一处地址')
    expect(reverseGeocode).toHaveBeenCalledTimes(2)
  })

  it('retries after an unsuccessful lookup', async () => {
    const reverseGeocode = vi.fn()
      .mockRejectedValueOnce(new Error('暂时不可用'))
      .mockResolvedValue('重试后的地址')
    const getAddress = createBaiduAddressCache(reverseGeocode)
    const location = { latitude: 39.9165, longitude: 116.4101 }

    await expect(getAddress(location, 'fixture-ak')).rejects.toThrow('暂时不可用')
    expect(await getAddress(location, 'fixture-ak')).toBe('重试后的地址')
    expect(reverseGeocode).toHaveBeenCalledTimes(2)
  })
})
