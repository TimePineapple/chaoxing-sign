import type { QrJobEvent, QrStreamSnapshot } from './qrSignProtocol'

export function connectQrSignEvents(
  onJob: (job: QrJobEvent) => void,
  onSnapshot: (snapshot: QrStreamSnapshot) => void,
  onDisconnected: () => void,
) {
  if (typeof EventSource === 'undefined') {
    onDisconnected()
    return () => {}
  }
  const source = new EventSource('/api/cx/qr-events')
  source.addEventListener('job', (event) => {
    try { onJob(JSON.parse((event as MessageEvent).data) as QrJobEvent) }
    catch { /* Ignore malformed events; the next snapshot reconciles state. */ }
  })
  source.addEventListener('snapshot', (event) => {
    try { onSnapshot(JSON.parse((event as MessageEvent).data) as QrStreamSnapshot) }
    catch { onDisconnected() }
  })
  source.onerror = onDisconnected
  return () => source.close()
}
