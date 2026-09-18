import { computed, onBeforeUnmount, ref, type ComputedRef } from 'vue'
import type { QrJobView, QrStreamSnapshot } from './qrSignProtocol'
import { QrSignOverlayTracker } from './qrSignOverlay'
import { getQrSignClientId } from './qrSignClient.client'

export function useQrSignOverlay(selectedUids: ComputedRef<string[]>) {
  const tracker = new QrSignOverlayTracker()
  const revision = ref(0)
  let expiryTimer: ReturnType<typeof setTimeout> | undefined

  function refresh() {
    if (expiryTimer)
      clearTimeout(expiryTimer)
    const now = Date.now()
    tracker.prune(now)
    revision.value++
    const expiresAt = tracker.nextExpiry(now)
    if (expiresAt !== null)
      expiryTimer = setTimeout(refresh, Math.max(1, expiresAt - now))
  }

  function applySnapshot(snapshot: QrStreamSnapshot) {
    tracker.applySnapshot(snapshot)
    refresh()
  }

  function applyJob(job: QrJobView) {
    tracker.applyJob(job)
    refresh()
  }

  function reset() {
    tracker.reset()
    if (expiryTimer)
      clearTimeout(expiryTimer)
    expiryTimer = undefined
    revision.value++
  }

  const mode = computed(() => {
    void revision.value
    return tracker.mode(selectedUids.value, getQrSignClientId())
  })

  onBeforeUnmount(reset)
  return { mode, applySnapshot, applyJob, reset }
}
