import { expect, it, vi } from 'vitest'

vi.mock('naive-ui', () => ({
  createDiscreteApi: () => ({ message: { error: vi.fn() } }),
}))

it('keeps the QR client and trace headers through the request hook', async () => {
  const create = vi.fn((_config: { onRequest: (context: { options: { headers: Headers } }) => Promise<void> }) => vi.fn())
  vi.stubGlobal('$fetch', { create })
  vi.resetModules()
  await import('./request')

  const config = create.mock.calls[0]?.[0]
  expect(config).toBeDefined()
  const options = { headers: new Headers({
    'x-qr-client-id': '7c6d33d0-41f2-4afd-b046-ec996958e3aa',
    'x-qr-sign-trace-id': 'trace-1',
  }) }
  await config!.onRequest({ options })
  expect(options.headers.get('x-qr-client-id')).toBe('7c6d33d0-41f2-4afd-b046-ec996958e3aa')
  expect(options.headers.get('x-qr-sign-trace-id')).toBe('trace-1')
  vi.unstubAllGlobals()
})
