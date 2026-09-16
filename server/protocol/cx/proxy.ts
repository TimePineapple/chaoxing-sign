import type { OptionsInit } from 'got'
import { Options, RequestError } from 'got'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'

const messages: Record<string, string> = {
  ERR_CX_PROXY_CONFIG: 'CX_PROXY_URL 配置无效，请填写 http:// 或 https:// 代理地址',
  ERR_CX_PROXY_AUTH: '学习通代理认证失败，请检查代理用户名和密码',
  ERR_CX_PROXY_CONNECTION: '学习通代理链路连接失败，请检查代理服务、出口网络及证书',
}

export class CxProxyError extends RequestError {
  constructor(code: string) {
    // Never retain the original got error: its options/cause may contain credentials.
    super(messages[code] || '学习通代理请求失败，请查看服务端错误代码', { code }, new Options())
    this.name = 'CxProxyError'
  }
}

function sanitizeProxyError(error: RequestError): RequestError {
  if (error.response?.statusCode === 407)
    return new CxProxyError('ERR_CX_PROXY_AUTH')

  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
    'ETIMEDOUT', 'EPROTO', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code))
    return new CxProxyError('ERR_CX_PROXY_CONNECTION')

  // Preserve upstream error codes used by the existing login diagnostics.
  return new CxProxyError(/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'UPSTREAM_ERROR')
}

export function createCxProxyOptions(value: string): OptionsInit {
  const raw = value.trim()
  if (!raw)
    return {}

  let proxy: URL
  try {
    proxy = new URL(raw)
    if (!['http:', 'https:'].includes(proxy.protocol) || !proxy.hostname
      || proxy.pathname !== '/' || proxy.search || proxy.hash)
      throw new Error('Invalid proxy URL')
    // Validate percent encoding before an agent attempts to build Basic auth.
    decodeURIComponent(proxy.username)
    decodeURIComponent(proxy.password)
  }
  catch {
    throw new CxProxyError('ERR_CX_PROXY_CONFIG')
  }

  return {
    agent: {
      http: new HttpProxyAgent(proxy),
      https: new HttpsProxyAgent(proxy),
    },
    hooks: { beforeError: [sanitizeProxyError] },
  }
}

let cachedValue: string | undefined
let cachedOptions: OptionsInit

export function getCxProxyOptions(): OptionsInit {
  // Read at runtime, never through public runtimeConfig or build-time defines.
  const value = (process.env.CX_PROXY_URL || '').trim()
  if (value !== cachedValue) {
    cachedOptions = createCxProxyOptions(value)
    cachedValue = value
  }
  return cachedOptions
}
