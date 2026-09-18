import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.resetModules())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('browser position for QR signing', () => {
  it('requests position only on the first QR modal opening during a page lifetime', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({
      coords: { latitude: 39.9, longitude: 116.4 },
    } as GeolocationPosition))
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    const location = await import('./clientLocation.client')

    await location.requestQrModalLocationOnce()
    await location.requestQrModalLocationOnce()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(await location.getClientLocationForQr()).toEqual({ latitude: 39.9, longitude: 116.4 })
  })

  it('requests a new position for every sign instead of reusing the previous one', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({
      coords: { latitude: 30 + getCurrentPosition.mock.calls.length, longitude: 120 },
    } as GeolocationPosition))
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    const location = await import('./clientLocation.client')

    expect(await location.getFreshClientLocationForSign()).toEqual({ latitude: 31, longitude: 120 })
    expect(await location.getFreshClientLocationForSign()).toEqual({ latitude: 32, longitude: 120 })
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
    expect(getCurrentPosition).toHaveBeenLastCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10_000,
    })
  })

  it('waits for a fresh reading and returns a copy of valid coordinates', async () => {
    let succeed!: (position: GeolocationPosition) => void
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn((success) => { succeed = success }),
      },
    })
    const location = await import('./clientLocation.client')
    const refresh = location.refreshClientLocation()
    const pending = location.getClientLocationForQr()
    expect(location.clientLocationStatus.value).toBe('loading')
    succeed({ coords: { latitude: 39.9, longitude: 116.4 } } as GeolocationPosition)
    await refresh
    const result = await pending
    expect(result).toEqual({ latitude: 39.9, longitude: 116.4 })
    expect(result).not.toBe(await location.getClientLocationForQr())
    expect(location.clientLocationStatus.value).toBe('ready')
  })

  it('ignores an older reading that arrives after a new refresh', async () => {
    const callbacks: Array<(position: GeolocationPosition) => void> = []
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn((success) => callbacks.push(success)),
      },
    })
    const location = await import('./clientLocation.client')
    const first = location.refreshClientLocation()
    const second = location.refreshClientLocation()
    callbacks[1]({ coords: { latitude: 30, longitude: 120 } } as GeolocationPosition)
    await second
    callbacks[0]({ coords: { latitude: 40, longitude: 116 } } as GeolocationPosition)
    await first
    expect(await location.getClientLocationForQr()).toEqual({ latitude: 30, longitude: 120 })
  })

  it('clears a previous position when a new reading is unavailable', async () => {
    let succeed!: (position: GeolocationPosition) => void
    let fail!: () => void
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn((success, error) => { succeed = success; fail = error }),
      },
    })
    const location = await import('./clientLocation.client')
    const first = location.refreshClientLocation()
    succeed({ coords: { latitude: 30, longitude: 120 } } as GeolocationPosition)
    await first
    const second = location.refreshClientLocation()
    fail()
    await second
    expect(await location.getClientLocationForQr()).toBeNull()
    expect(location.clientLocationStatus.value).toBe('unavailable')
  })
})
