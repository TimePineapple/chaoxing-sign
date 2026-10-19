import { createDiscreteApi } from 'naive-ui'

const { message } = createDiscreteApi(
  ['message'],
)

export function getHeaders(defaultHeaders: HeadersInit = {}) {
  // ofetch normalizes request headers to a Headers instance before onRequest.
  // Spreading that instance drops every header, including x-qr-client-id.
  return new Headers(defaultHeaders)
}

const _fetch = $fetch.create({
  async onRequest({ options }) {
    options.headers = getHeaders(options.headers)
  },
  async onResponse() {
  },
  async onResponseError({ response, options }) {
    const state = response._data?.data
    if (state?.code === 'CX_SESSION_EXPIRED' && state.uid && state.lastLoginTime
      && typeof useAccountStore !== 'undefined') {
      useAccountStore().applyAccountSession({ uid: state.uid, loginExpired: true, lastLoginTime: state.lastLoginTime })
    }
    options?.params?.noMessage || message.error(response._data.message || '服务器错误')
  },
})

const request = _fetch
// export const request = (...args: Parameters<typeof _fetch>): ReturnType<typeof _fetch> => _fetch(...args)
export default request
