import { expect, it, vi } from 'vitest'
import { qrJobFeedbackMessage } from './qrSignFeedback'

it('keeps one ID per loaded page and gives a second page a different ID', async () => {
  vi.resetModules()
  const firstPage = await import('./qrSignClient.client')
  const id = firstPage.getQrSignClientId()
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  expect(firstPage.getQrSignClientId()).toBe(id)
  expect(firstPage.isOtherQrSignClient(id)).toBe(false)

  vi.resetModules()
  const secondPage = await import('./qrSignClient.client')
  const secondId = secondPage.getQrSignClientId()
  expect(secondId).not.toBe(id)
  expect(secondPage.isOtherQrSignClient(id)).toBe(true)
  expect(firstPage.isOtherQrSignClient(secondId)).toBe(true)
  expect(qrJobFeedbackMessage({
    id: 'job-1', uid: 'cx-a', activityId: '10', clientId: id,
    submittedAt: Date.now(), state: 'running', message: '正在提交',
  }, secondPage.isOtherQrSignClient(id))).toBe('正在提交')
})
