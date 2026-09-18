import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Reuse the Vue plugin already installed with Nuxt; no new test dependencies.
const fromProject = createRequire(import.meta.url)
const fromNuxt = createRequire(fromProject.resolve('nuxt/package.json'))
const vue = fromNuxt('@vitejs/plugin-vue')

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: {
    '#auth': fileURLToPath(new URL('./auth.stub.ts', import.meta.url)),
    '~~': fileURLToPath(new URL('../', import.meta.url)),
    '~': fileURLToPath(new URL('../', import.meta.url)),
  } },
  test: {
    environment: 'jsdom',
    include: [
      'tests/qr-code-sign.integration.ts',
      'tests/qr-code-sign.ui.ts',
      'tests/qr-code-sign-events.ui.ts',
      'tests/qr-code-sign-account.ui.ts',
      'tests/cx-connectivity.client.test.ts',
      'server/protocol/cx/connectivity.unit.test.ts',
      'server/protocol/cx/qrLocation.test.ts',
      'server/utils/qrSignQueue.test.ts',
      'server/utils/qrLocation.test.ts',
      'server/utils/baiduReverseGeocode.test.ts',
      'server/utils/recentSigns.test.ts',
      'server/utils/cxRequestStartQueue.test.ts',
      'server/utils/recentSignBus.test.ts',
      'server/utils/createSignLog.test.ts',
      'tests/recent-sign-writes.ts',
      'tests/recent-sign-events.ui.ts',
      'tests/recent-sign-sse.test.ts',
      'tests/cx-login-ownership.test.ts',
      'tests/qr-code-sign-sse.test.ts',
      'utils/qrCodeSign.unit.test.ts',
      'utils/clientLocation.client.test.ts',
      'tests/manual-location-sign.client.test.ts',
    ],
  },
})
