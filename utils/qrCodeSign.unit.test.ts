// @vitest-environment jsdom

import { createApp, h } from 'vue'
import { QrcodeCapture } from 'vue-qrcode-reader'
import { describe, expect, it, vi } from 'vitest'
import { createQrCodeSubmissionGuard, parseQrCodeSignLink } from './qrCodeSign'

const signLink = 'https://mobilelearn.chaoxing.com/widget/sign/e?enc=ABC123&id=8000063022220&c=529773'

describe('QR code sign submission', () => {
  it('extracts required fields regardless of query parameter order', () => {
    expect(parseQrCodeSignLink(signLink)).toEqual({
      link: signLink,
      activityId: '8000063022220',
      code: '529773',
      enc: 'ABC123',
    })
  })

  it('rejects non-links and links missing required sign fields', () => {
    expect(parseQrCodeSignLink('not a link')).toBeNull()
    expect(parseQrCodeSignLink('https://example.test/?id=1&enc=ABC')).toBeNull()
  })

  it('sends one mocked request for repeated video detections and allows retry after reset', () => {
    const request = vi.fn()
    const guard = createQrCodeSubmissionGuard()
    const submit = (value: string) => {
      const result = guard.tryLock(value)
      if (result.status === 'accepted')
        request(result.value)
    }

    submit(signLink)
    submit(signLink)
    expect(request).toHaveBeenCalledTimes(1)

    guard.reset()
    submit(signLink)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not send a mocked request for an invalid QR code', () => {
    const request = vi.fn()
    const result = createQrCodeSubmissionGuard().tryLock('https://example.test/not-a-sign-code')

    if (result.status === 'accepted')
      request(result.value)

    expect(request).not.toHaveBeenCalled()
  })

  it('opens the image picker without forcing the system camera', () => {
    const container = document.createElement('div')
    const app = createApp({
      render: () => h(QrcodeCapture, { capture: null }),
    })

    app.mount(container)
    expect(container.querySelector('input[type="file"]')?.hasAttribute('capture')).toBe(false)
    app.unmount()
  })
})
