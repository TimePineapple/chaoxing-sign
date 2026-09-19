import { describe, expect, it } from 'vitest'
import { qrSignScannerCovered, qrSignSubmissionAllowed, QrSignOverlayTracker } from './qrSignOverlay'
import type { QrJobView } from './qrSignProtocol'

const now = new Date('2026-01-01T12:00:00.000Z').getTime()
function job(uid: string, state: QrJobView['state'], clientId: string, id = uid): QrJobView {
  return { id, uid, activityId: '10', clientId, submittedAt: now,
    completedAt: state === 'success' ? now : undefined, state, message: state }
}

describe('QR scanner overlay', () => {
  it('keeps the scanner visible but suppresses submission while another client runs', () => {
    expect(qrSignScannerCovered('waiting')).toBe(false)
    expect(qrSignSubmissionAllowed('waiting')).toBe(false)
    expect(qrSignScannerCovered('completed')).toBe(true)
    expect(qrSignSubmissionAllowed('completed')).toBe(false)
    expect(qrSignSubmissionAllowed('none')).toBe(true)
  })

  it('waits only for selected jobs submitted by another client', () => {
    const tracker = new QrSignOverlayTracker()
    tracker.applySnapshot({ active: [job('a', 'queued', 'primary')], recentSuccess: [] }, now)
    expect(tracker.mode(['a'], 'primary', now)).toBe('none')
    expect(tracker.mode(['a', 'b'], 'other', now)).toBe('waiting')
    expect(tracker.mode(['b'], 'other', now)).toBe('none')
    tracker.applyJob(job('a', 'running', 'primary'), now)
    expect(tracker.mode(['a'], 'other', now)).toBe('waiting')
    tracker.applyJob(job('b', 'queued', 'other'), now)
    expect(tracker.mode(['a', 'b'], 'primary', now)).toBe('waiting')
    expect(tracker.mode(['a', 'b'], 'other', now)).toBe('waiting')
  })

  it('marks all selected accounts completed only when each succeeded on another client', () => {
    const tracker = new QrSignOverlayTracker()
    tracker.applyJob(job('a', 'success', 'primary', 'a-1'), now)
    expect(tracker.mode(['a', 'b'], 'viewer', now)).toBe('none')
    tracker.applyJob({ ...job('b', 'success', 'second', 'b-1'), activityId: 'different' }, now)
    expect(tracker.mode(['a', 'b'], 'viewer', now)).toBe('completed')
    expect(tracker.mode(['a', 'b'], 'primary', now)).toBe('none')
    expect(tracker.mode([], 'viewer', now)).toBe('none')
    tracker.applyJob(job('a', 'queued', 'primary', 'a-2'), now)
    expect(tracker.mode(['a', 'b'], 'viewer', now)).toBe('waiting')
    expect(tracker.mode(['a', 'b'], 'primary', now)).toBe('none')
  })

  it('clears waiting after failure and reconciles from a new snapshot', () => {
    const tracker = new QrSignOverlayTracker()
    tracker.applyJob(job('a', 'running', 'primary'), now)
    tracker.applyJob(job('a', 'error', 'primary'), now)
    expect(tracker.mode(['a'], 'other', now)).toBe('none')
    tracker.applySnapshot({ active: [job('b', 'running', 'second')], recentSuccess: [] }, now)
    expect(tracker.mode(['a'], 'other', now)).toBe('none')
    expect(tracker.mode(['b'], 'other', now)).toBe('waiting')
    tracker.applySnapshot({ active: [], recentSuccess: [job('a', 'success', 'primary')] }, now)
    expect(tracker.mode(['a'], 'other', now)).toBe('completed')
    expect(tracker.mode(['b'], 'other', now)).toBe('none')
  })

  it('expires completed state one minute after success', () => {
    const tracker = new QrSignOverlayTracker()
    tracker.applyJob(job('a', 'success', 'primary'), now)
    expect(tracker.nextExpiry(now)).toBe(now + 60_000)
    expect(tracker.mode(['a'], 'other', now + 59_999)).toBe('completed')
    expect(tracker.mode(['a'], 'other', now + 60_000)).toBe('none')
    expect(tracker.nextExpiry(now + 60_000)).toBeNull()
  })
})
