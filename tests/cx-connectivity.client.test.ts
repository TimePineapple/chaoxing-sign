import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, ref, watch } from 'vue'
import CxConnectivityCheck from '../components/CxConnectivityCheck.client.vue'

let app: ReturnType<typeof createApp> | undefined

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('checks once whenever the website app is opened and shows a persistent notification on failure', async () => {
  const status = ref('authenticated')
  const data = ref({ uid: 'website-user-1' })
  const error = vi.fn()
  const fetch = vi.fn().mockResolvedValue({
    code: 200,
    data: { ok: false, message: '学习通登录页发生循环重定向，服务器出口可能已被限制' },
  })
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useAuth', () => ({ status, data }))
  vi.stubGlobal('useNotification', () => ({ error }))
  vi.stubGlobal('$fetch', fetch)

  const container = document.createElement('div')
  app = createApp(CxConnectivityCheck)
  app.mount(container)
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
  expect(fetch).toHaveBeenCalledWith('/api/cx/connectivity')
  expect(error).toHaveBeenCalledWith(expect.objectContaining({
    title: '学习通连接失败',
    duration: 0,
    closable: true,
  }))

  data.value = { uid: 'website-user-2' }
  await nextTick()
  expect(fetch).toHaveBeenCalledTimes(1)

  app.unmount()
  app = createApp(CxConnectivityCheck)
  app.mount(container)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
})

it('does not check before the client is authenticated', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useAuth', () => ({ status: ref('unauthenticated'), data: ref(null) }))
  vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))
  vi.stubGlobal('$fetch', fetch)

  app = createApp(CxConnectivityCheck)
  app.mount(document.createElement('div'))
  await nextTick()
  expect(fetch).not.toHaveBeenCalled()
})
