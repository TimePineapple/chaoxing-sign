// Run with tests/qr-code-sign.config.ts, which supplies Vue compilation and Nuxt aliases.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onMounted, ref, toRef, unref, watch } from 'vue'
import { ResOp } from '../server/utils'
import { getQrSignTraceId, isQrSignRequest } from '../server/utils/qrSignTrace'
import Operation from '../components/Operation.vue'

vi.mock('naive-ui', () => ({ createDiscreteApi: () => ({ message: {} }) }))
vi.mock('pinia', () => ({ skipHydrate: (value: unknown) => value }))

const signLink = 'https://mobilelearn.chaoxing.com/widget/sign/e?id=100&c=200&enc=FIXTURE'
const log = vi.fn()
let store: any
let request: ReturnType<typeof vi.fn>
let handler: any
let app: ReturnType<typeof createApp> | undefined
let container: HTMLDivElement
let component: any
const clients = new Map<string, any>()
const savedCourses = new Map<string, { courseId: string }>()

function client(uid: string) {
  const value = {
    user: { uid },
    getActivityDetail: vi.fn().mockResolvedValue({
      id: 100, courseId: 'current-course', clazzId: 300,
      activeType: 2, status: 1, otherId: 2, name: 'Fixture sign',
    }),
    preSign: vi.fn().mockResolvedValue(undefined),
    courseList: [],
    getCourseList: vi.fn().mockResolvedValue([]),
    signQrCode: vi.fn().mockResolvedValue('签到成功'),
    save: vi.fn().mockResolvedValue({}),
  }
  clients.set(uid, value)
  return value
}

beforeEach(async () => {
  log.mockReset()
  clients.clear()
  savedCourses.clear()
  vi.stubGlobal('defineStore', (_name: string, setup: () => unknown) => setup)
  for (const [name, value] of Object.entries({ ref, computed, toRef, unref, onMounted, watch }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useLogStore', () => ({ log }))
  vi.stubGlobal('useMessage', () => ({ warning: vi.fn() }))
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('readBody', (event: any) => Promise.resolve(event.body))
  vi.stubGlobal('getHeader', (event: any, name: string) => event.headers?.[name])
  vi.stubGlobal('ResOp', ResOp)
  handler = (await import('../server/api/cx/accounts/[uid]/sign_by_qrcode.post')).default
  request = vi.fn(async (url, options) => {
    const uid = options.body.uid
    expect(url).toBe(`/api/cx/accounts/${uid}/sign_by_qrcode`)
    const cx = clients.get(uid)
    return handler({
      body: options.body,
      headers: options.headers,
      context: {
        cx,
        prisma: {
          course: {
            findFirst: vi.fn().mockImplementation((query) => {
              expect(query).toEqual(expect.objectContaining({
                where: { classId: '300', accounts: { some: { uid } } },
              }))
              return Promise.resolve(savedCourses.get(uid) ?? null)
            }),
          },
          signLog: { create: cx.save },
        },
      },
    })
  })
  vi.stubGlobal('request', request)
  const { useAccountStore } = await import('../stores/account')
  store = useAccountStore()
  store.accounts.value = ['a', 'b', 'not-selected'].map(uid => {
    client(uid)
    return { uid, info: { realname: `Account ${uid}` }, selected: uid !== 'not-selected' }
  })
  // Match Pinia's ref-unwrapping in the component.
  const componentStore = new Proxy(store, { get: (target, key) => unref(target[key]) })
  vi.stubGlobal('useAccountStore', () => componentStore)
  const modal = defineComponent({
    props: ['loading'],
    emits: ['success'],
    setup(props, { emit, slots }) {
      return () => h('div', [
        h('button', { id: 'detect', disabled: props.loading, onClick: () => emit('success', signLink) }, 'Detect'),
        slots.result?.(),
      ])
    },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(Operation)
  app.config.warnHandler = () => {}
  app.component('QrCodeSignModal', modal)
  const wrapper = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  for (const name of ['NButton', 'NText'])
    app.component(name, wrapper)
  component = app.mount(container)
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('batch QR scan component -> store -> API with mocked upstream', () => {
  it('resolves a missing activity course ID from each account’s saved course', async () => {
    for (const uid of ['a', 'b']) {
      clients.get(uid).getActivityDetail.mockResolvedValue({
        id: 100, clazzId: 300, activeType: 2, status: 1, otherId: 2, name: 'Fixture sign',
      })
      savedCourses.set(uid, { courseId: `course-${uid}` })
    }
    await component.$.setupState.handleSuccess(signLink)
    expect(request).toHaveBeenCalledTimes(2)
    expect(clients.get('a').preSign).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'course-a', classId: 300 }), expect.anything())
    expect(clients.get('b').preSign).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'course-b', classId: 300 }), expect.anything())
    expect(clients.get('a').getCourseList).not.toHaveBeenCalled()
    expect(container.textContent).toContain('批量扫码完成：成功 2 个，失败 0 个')
  })

  it('uses the account course cache before the database or network', async () => {
    clients.get('a').getActivityDetail.mockResolvedValue({ id: 100, clazzId: 300, activeType: 2, status: 1, otherId: 2, name: 'Fixture sign' })
    clients.get('a').courseList = [{ classId: '300', courseId: 'cached-course' }]
    await store.signByQrCode('a', signLink)
    expect(clients.get('a').preSign).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'cached-course', classId: 300 }), expect.anything())
    expect(clients.get('a').getCourseList).not.toHaveBeenCalled()
  })

  it('fetches the account course list when no cached or saved class matches', async () => {
    clients.get('a').getActivityDetail.mockResolvedValue({ id: 100, clazzId: 300, activeType: 2, status: 1, otherId: 2, name: 'Fixture sign' })
    clients.get('a').getCourseList.mockResolvedValue([{ classId: '300', courseId: 'live-course' }])
    await store.signByQrCode('a', signLink)
    expect(clients.get('a').getCourseList).toHaveBeenCalledOnce()
    expect(clients.get('a').preSign).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'live-course', classId: 300 }), expect.anything())
  })

  it('reports an unmatched class without submitting a sign request', async () => {
    clients.get('a').getActivityDetail.mockResolvedValue({ id: 100, clazzId: 300, activeType: 2, status: 1, otherId: 2, name: 'Fixture sign' })
    await expect(store.signByQrCode('a', signLink)).rejects.toThrow('未能在该账号的课程列表中匹配签到班级')
    expect(clients.get('a').preSign).not.toHaveBeenCalled()
    expect(clients.get('a').signQrCode).not.toHaveBeenCalled()
  })
  it('recognizes the QR API before route handling and keeps its validated trace ID', () => {
    const event = {
      node: { req: { url: '/api/cx/accounts/a/sign_by_qrcode', headers: { 'x-qr-sign-trace-id': 'qr-fixture-123456' } } },
      context: {},
    } as any
    expect(isQrSignRequest(event)).toBe(true)
    expect(getQrSignTraceId(event)).toBe('qr-fixture-123456')
    expect(getQrSignTraceId(event)).toBe('qr-fixture-123456')
  })
  it('writes matching client and server trace IDs for each account without QR tokens', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await component.$.setupState.handleSuccess(signLink)
    expect(request).toHaveBeenCalledTimes(2)
    const traceIds = request.mock.calls.map(([, options]) => options.headers['x-qr-sign-trace-id'])
    expect(new Set(traceIds).size).toBe(2)
    for (const traceId of traceIds) {
      expect(traceId).toMatch(/^qr-[a-z0-9-]{6,64}$/)
      expect(info).toHaveBeenCalledWith(`[qr-code-sign][${traceId}] 客户端发送请求`)
      expect(info).toHaveBeenCalledWith(`[qr-code-sign][${traceId}] request received`, expect.objectContaining({ elapsedMs: expect.any(Number) }))
      expect(info).toHaveBeenCalledWith(`[qr-code-sign][${traceId}] request complete`, expect.objectContaining({ success: true }))
      expect(container.textContent).toContain(`追踪号 ${traceId}`)
    }
    expect(info.mock.calls.flat().join(' ')).not.toContain('FIXTURE')
  })
  it('submits a decoded QR once for each selected account, with independent context and course', async () => {
    container.querySelector<HTMLButtonElement>('#detect')!.click()
    await vi.waitFor(() => expect(container.textContent).toContain('Account b (b): 签到成功'))
    expect(request).toHaveBeenCalledTimes(2)
    for (const uid of ['a', 'b']) {
      expect(clients.get(uid).preSign).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: 'current-course', classId: 300 }), expect.objectContaining({ id: 100 }),
      )
      expect(clients.get(uid).save).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accountId: uid }) }))
    }
    expect(clients.get('not-selected').signQrCode).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('批量扫码完成：成功 2 个，失败 0 个', { type: 'success' })
  })

  it('shows a non-empty per-account reason when every upstream request throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const uid of ['a', 'b'])
      clients.get(uid).getActivityDetail.mockRejectedValue(Object.assign(new Error('private request details'), { code: 'ECONNRESET' }))
    await component.$.setupState.handleSuccess(signLink)
    await nextTick()
    expect(container.textContent).toContain('Account a (a): 读取活动详情失败（ECONNRESET）')
    expect(container.textContent).toContain('Account b (b): 读取活动详情失败（ECONNRESET）')
    expect(container.textContent).not.toContain('private request details')
    expect(log).toHaveBeenCalledWith('批量扫码完成：成功 0 个，失败 2 个', { type: 'error' })
    expect(component.$.setupState.qrCodeLoading).toBe(false)
  })

  it('separates success from upstream rejection and preserves the rejection text', async () => {
    clients.get('b').signQrCode.mockResolvedValue('签到已过期')
    await component.$.setupState.handleSuccess(signLink)
    await nextTick()
    expect(container.textContent).toContain('Account b (b): 签到已过期')
    expect(log).toHaveBeenCalledWith('批量扫码完成：成功 1 个，失败 1 个', { type: 'warning' })
  })

  it('preserves API error messages instead of destructuring null data', async () => {
    request.mockResolvedValue(ResOp.error(204, '活动不存在'))
    await expect(store.signByQrCode('a', signLink)).rejects.toThrow('活动不存在')
    request.mockResolvedValue(ResOp.success(null))
    await expect(store.signByQrCode('a', signLink)).rejects.toThrow('签到接口未返回有效结果')
    request.mockResolvedValue(null)
    await expect(store.signByQrCode('a', signLink)).rejects.toThrow('签到接口返回错误或空响应')
  })

  it('reports the pre-sign step and prevents submission after a pre-sign exception', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    clients.get('a').preSign.mockRejectedValue(Object.assign(new Error('upstream'), { code: 'ETIMEDOUT' }))
    await expect(store.signByQrCode('a', signLink)).rejects.toThrow('预签到失败（ETIMEDOUT）')
    expect(clients.get('a').signQrCode).not.toHaveBeenCalled()
  })

  it('rejects an empty upstream result and reports a record error after successful submission', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    clients.get('a').signQrCode.mockResolvedValue('')
    await expect(store.signByQrCode('a', signLink)).rejects.toThrow('学习通返回了空的签到结果')
    expect(clients.get('a').save).not.toHaveBeenCalled()
    clients.get('b').save.mockRejectedValue(Object.assign(new Error('database credentials'), { code: 'P1001' }))
    await expect(store.signByQrCode('b', signLink)).rejects.toThrow('保存签到记录（签到请求已发送，请先核对签到状态）失败（P1001）')
  })

  it('shows HTTP login errors and allows a new submission after failure', async () => {
    request.mockRejectedValueOnce({ statusCode: 401, data: { message: '登录已过期,请重新登录' } })
    await component.$.setupState.handleSuccess(signLink)
    await nextTick()
    expect(container.textContent).toContain('登录已过期,请重新登录')
    await component.$.setupState.handleSuccess(signLink)
    expect(log).toHaveBeenLastCalledWith('批量扫码完成：成功 2 个，失败 0 个', { type: 'success' })
  })

  it('does not send a course from a previous activity, and prefers the server activity course', async () => {
    component.$.setupState.doingActivity = { id: 99, course: { courseId: 'old-course' } }
    await component.$.setupState.handleSuccess(signLink)
    expect(request.mock.calls[0][1].body.courseId).toBeUndefined()
    await store.signByQrCode('a', signLink, 'old-course')
    expect(clients.get('a').preSign).toHaveBeenLastCalledWith(
      expect.objectContaining({ courseId: 'current-course' }), expect.anything(),
    )
  })

  it('blocks duplicate submissions while pending and guards an empty selection', async () => {
    let resolve!: (value: unknown) => void
    request.mockReturnValue(new Promise(done => { resolve = done }))
    const pending = component.$.setupState.handleSuccess(signLink)
    await component.$.setupState.handleSuccess(signLink)
    expect(request).toHaveBeenCalledTimes(2)
    resolve(ResOp.success({ activity: { otherId: 2 }, result: '签到成功' }))
    await pending
    store.accounts.value = []
    await component.$.setupState.handleSuccess(signLink)
    expect(request).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenLastCalledWith('请先选择账号', { type: 'warning' })
  })

  it('renders each completed account while another response is still pending', async () => {
    let finish!: (value: unknown) => void
    request.mockImplementationOnce(() => Promise.resolve(ResOp.success({ activity: { otherId: 2 }, result: '签到成功' })))
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = component.$.setupState.handleSuccess(signLink)
    await nextTick()
    await vi.waitFor(() => expect(container.textContent).toContain('Account a (a): 签到成功'))
    expect(container.textContent).toContain('Account b (b): 请求已发起')
    expect(component.$.setupState.qrCodeLoading).toBe(true)
    finish(ResOp.success({ activity: { otherId: 2 }, result: '签到已过期' }))
    await pending
    await nextTick()
    expect(container.textContent).toContain('批量扫码完成：成功 1 个，失败 1 个')
  })

  it('preserves results even when toast or log rendering throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    log.mockImplementation(() => { throw new Error('message render failed') })
    await component.$.setupState.handleSuccess(signLink)
    await nextTick()
    expect(container.textContent).toContain('Account a (a): 签到成功')
    expect(container.textContent).toContain('批量扫码完成：成功 2 个，失败 0 个')
    expect(component.$.setupState.qrCodeLoading).toBe(false)
    expect(request.mock.calls[0][1]).toMatchObject({ timeout: 45000, retry: 0 })
  })

  it('shows an uncertain outcome on timeout without exposing request URLs', async () => {
    request.mockRejectedValue({ name: 'FetchError', cause: { name: 'TimeoutError' } })
    await component.$.setupState.handleSuccess(signLink)
    await nextTick()
    expect(container.textContent).toContain('等待签到响应超时，结果尚未确认')
    expect(component.$.setupState.qrCodeLoading).toBe(false)
  })
})
