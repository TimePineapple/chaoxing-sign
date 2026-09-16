import type { Response } from 'got'
import { RequestError } from 'got'
import got from 'got'
import { CxProxyError, getCxProxyOptions } from './proxy'

export const CX_LOGIN_PAGE_URL = 'https://passport2.chaoxing.com/login'

export interface CxConnectivityResult {
  ok: boolean
  message?: string
}

function isPassportAccessDenied(response: Response<string>) {
  try {
    const target = new URL(response.url)
    return target.hostname.endsWith('.chaoxing.com')
      && target.pathname === '/views/error/passport403.html'
  }
  catch {
    return false
  }
}

export function cxConnectivityErrorMessage(error: unknown) {
  if (error instanceof CxProxyError && error.code === 'ERR_TOO_MANY_REDIRECTS')
    return '学习通登录页发生循环重定向，服务器出口可能已被限制'

  if (error instanceof CxProxyError)
    return error.message

  if (error instanceof RequestError) {
    if (error.code === 'ERR_TOO_MANY_REDIRECTS')
      return '学习通登录页发生循环重定向，服务器出口可能已被限制'
    if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error.code))
      return '服务器连接学习通登录页超时'
    if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error.code))
      return '服务器无法连接学习通登录页，请检查代理和出口网络'
    if (['EPROTO', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code))
      return '服务器连接学习通时 TLS 证书校验失败'
  }

  return '服务器访问学习通登录页失败，请查看服务端日志'
}

export async function checkCxConnectivity(target = CX_LOGIN_PAGE_URL): Promise<CxConnectivityResult> {
  try {
    const response = await got.get(target, {
      ...getCxProxyOptions(),
      responseType: 'text',
      timeout: { request: 10_000 },
      retry: { limit: 0 },
      maxRedirects: 5,
      throwHttpErrors: false,
    })

    if (isPassportAccessDenied(response))
      return { ok: false, message: '学习通拒绝了服务器出口访问（HTTP 403）' }

    if (response.statusCode >= 200 && response.statusCode < 400)
      return { ok: true }

    return {
      ok: false,
      message: `学习通登录页返回异常状态（HTTP ${response.statusCode}）`,
    }
  }
  catch (error) {
    const failure = error as { code?: string; response?: { statusCode?: number } }
    console.warn('[cx.connectivity] failed', {
      code: failure?.code,
      status: failure?.response?.statusCode,
    })
    return { ok: false, message: cxConnectivityErrorMessage(error) }
  }
}
