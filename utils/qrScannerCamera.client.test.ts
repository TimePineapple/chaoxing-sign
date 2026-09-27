import { describe, expect, it, vi } from 'vitest'
import { applyQrCameraZoom, enableQrCameraAutofocus, qrCameraConstraints, qrCameraZoomRange } from './qrScannerCamera.client'

function camera(capabilities: object = {}, settings: object = {}, applyConstraints = vi.fn().mockResolvedValue(undefined)) {
  return {
    getCapabilities: vi.fn(() => capabilities),
    getSettings: vi.fn(() => settings),
    applyConstraints,
  } as unknown as MediaStreamTrack
}

describe('QR camera compatibility', () => {
  it('keeps the selected lens when falling back from 4K to default camera settings', () => {
    expect(qrCameraConstraints(null, 'distant')).toMatchObject({
      facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 },
    })
    expect(qrCameraConstraints('telephoto', 'distant')).toMatchObject({
      deviceId: { exact: 'telephoto' }, width: { ideal: 3840 },
    })
    expect(qrCameraConstraints('telephoto', 'fallback')).toMatchObject({
      deviceId: { exact: 'telephoto' }, width: { ideal: 1920 }, height: { ideal: 1080 },
    })
    expect(qrCameraConstraints('telephoto', 'compatible')).toEqual({ deviceId: { exact: 'telephoto' } })
  })

  it('does not enable autofocus when the selected camera does not expose continuous focus', async () => {
    const track = camera({ focusMode: ['manual'] })
    await enableQrCameraAutofocus(track)
    expect(track.applyConstraints).not.toHaveBeenCalled()
  })

  it('requests supported continuous focus without aborting scanning on rejection', async () => {
    const track = camera({ focusMode: ['continuous'] }, {}, vi.fn().mockRejectedValue(new Error('unsupported control')))
    await expect(enableQrCameraAutofocus(track)).resolves.toBeUndefined()
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] })
  })

  it('handles cameras without the capabilities API or with a throwing API', async () => {
    const missing = { getSettings: () => ({}) } as unknown as MediaStreamTrack
    const throwing = { getCapabilities: () => { throw new Error('unavailable') } } as unknown as MediaStreamTrack
    expect(qrCameraZoomRange(missing)).toBeNull()
    expect(qrCameraZoomRange(throwing)).toBeNull()
    await expect(enableQrCameraAutofocus(missing)).resolves.toBeUndefined()
  })

  it.each([
    {},
    { zoom: { min: 1, max: 1, step: 0 } },
    { zoom: { min: 1, max: Number.POSITIVE_INFINITY, step: 0.1 } },
    { zoom: { min: 0, max: 3, step: 0.1 } },
  ])('hides zoom controls for unsupported or invalid ranges: %j', (capabilities) => {
    expect(qrCameraZoomRange(camera(capabilities))).toBeNull()
  })

  it('clamps requested zoom to the camera range and aligns it to hardware steps', async () => {
    const track = camera()
    const range = { min: 1, max: 1.8, step: 0.25 }
    await expect(applyQrCameraZoom(track, 2, range)).resolves.toBe(1.75)
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1.75 }] })
    await expect(applyQrCameraZoom(track, 0.5, range)).resolves.toBe(1)
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1 }] })
  })

  it('reports the actual zoom accepted by the camera', async () => {
    const track = camera({}, { zoom: 1.5 })
    await expect(applyQrCameraZoom(track, 2, { min: 1, max: 4, step: 0.1 })).resolves.toBe(1.5)
  })

  it('allows the UI to handle a rejected zoom request', async () => {
    const track = camera({}, {}, vi.fn().mockRejectedValue(new Error('camera disconnected')))
    await expect(applyQrCameraZoom(track, 2, { min: 1, max: 4, step: 0.1 })).rejects.toThrow('camera disconnected')
  })
})
