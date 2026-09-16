import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Reuse the Vue plugin already installed with Nuxt; no new test dependencies.
const fromProject = createRequire(import.meta.url)
const fromNuxt = createRequire(fromProject.resolve('nuxt/package.json'))
const vue = fromNuxt('@vitejs/plugin-vue')

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '~': fileURLToPath(new URL('../', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['tests/qr-code-sign.integration.ts', 'tests/qr-code-sign.ui.ts', 'utils/qrCodeSign.unit.test.ts'],
  },
})
