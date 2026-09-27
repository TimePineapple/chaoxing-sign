export interface QrCameraZoomRange {
  min: number
  max: number
  step: number
}

export type QrCameraProfile = 'distant' | 'fallback' | 'compatible'

type QrCameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[]
  zoom?: QrCameraZoomRange
}

type QrCameraSettings = MediaTrackSettings & { zoom?: number }
type QrCameraControls = MediaTrackConstraintSet & { focusMode?: 'continuous'; zoom?: number }

export function qrCameraConstraints(deviceId: string | null, profile: QrCameraProfile): MediaTrackConstraints {
  const camera = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: 'environment' } }

  if (profile === 'compatible')
    return camera

  return {
    ...camera,
    width: { ideal: profile === 'distant' ? 3840 : 1920 },
    height: { ideal: profile === 'distant' ? 2160 : 1080 },
    frameRate: { ideal: 30, max: 30 },
  }
}

export function qrCameraZoomRange(track: MediaStreamTrack): QrCameraZoomRange | null {
  try {
    const zoom = (track.getCapabilities?.() as QrCameraCapabilities | undefined)?.zoom
    if (!zoom || !Number.isFinite(zoom.min) || !Number.isFinite(zoom.max) || zoom.min <= 0 || zoom.max <= zoom.min)
      return null

    return {
      min: zoom.min,
      max: zoom.max,
      step: Number.isFinite(zoom.step) && zoom.step > 0 ? zoom.step : Math.min(0.1, zoom.max - zoom.min),
    }
  }
  catch {
    return null
  }
}

export function qrCameraZoomValue(value: number, range: QrCameraZoomRange): number {
  const bounded = Math.max(range.min, Math.min(range.max, Number.isFinite(value) ? value : range.min))
  const maxSteps = Math.floor((range.max - range.min) / range.step + 1e-8)
  const steps = Math.min(maxSteps, Math.round((bounded - range.min) / range.step))
  return Number((range.min + steps * range.step).toFixed(8))
}

export function currentQrCameraZoom(track: MediaStreamTrack, range: QrCameraZoomRange): number {
  return qrCameraZoomValue((track.getSettings() as QrCameraSettings).zoom ?? 1, range)
}

export async function enableQrCameraAutofocus(track: MediaStreamTrack): Promise<void> {
  try {
    const capabilities = track.getCapabilities?.() as QrCameraCapabilities | undefined
    if (capabilities?.focusMode?.includes('continuous')) {
      const controls: QrCameraControls = { focusMode: 'continuous' }
      await track.applyConstraints({ advanced: [controls] })
    }
  }
  catch {
    // Optional camera controls must not prevent QR scanning.
  }
}

export async function applyQrCameraZoom(track: MediaStreamTrack, value: number, range: QrCameraZoomRange): Promise<number> {
  const zoom = qrCameraZoomValue(value, range)
  const controls: QrCameraControls = { zoom }
  await track.applyConstraints({ advanced: [controls] })
  return qrCameraZoomValue((track.getSettings() as QrCameraSettings).zoom ?? zoom, range)
}
