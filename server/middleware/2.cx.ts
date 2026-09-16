import { Cookie } from 'tough-cookie'
import { CXMap, Cx } from '~~/server/protocol/cx'
import { prisma } from '~~/server/utils/db'
import { getQrSignTraceId, isQrSignRequest } from '~/server/utils/qrSignTrace'

declare module 'h3' {
  interface H3EventContext {
    cx: Cx
  }
}

const exclude = ['/api/cx/login', '/api/cx/accounts', '/api/cx/connectivity']

export default eventHandler(async (event) => {
  const { context, node: { req } } = event
  const traceId = isQrSignRequest(event) ? getQrSignTraceId(event) : null
  try {
    if (req.url?.startsWith('/api/auth'))
      return

    if (exclude.includes(req.url))
      return

    if (!req.url?.startsWith('/api/cx'))
      return

    if (traceId)
      console.info(`[qr-code-sign][${traceId}] account context start`)

    const method = req.method
    let uid = 0

    if (method === 'GET')
      uid = context.params?.uid || getQuery(event)?.uid

    else
      uid = (await readBody(event))?.uid as string

    if (!uid) {
      if (traceId)
        console.warn(`[qr-code-sign][${traceId}] account id missing`)
      return createError({ statusCode: 400, message: '请求账号不存在' })
    }

    const cx = CXMap.get(uid)
    if (cx) {
      context.cx = cx
      if (traceId)
        console.info(`[qr-code-sign][${traceId}] account context cache hit`)
    }
    else {
      if (traceId)
        console.info(`[qr-code-sign][${traceId}] account lookup start`)
      const account = await prisma.cxAccount.findUnique({ where: { uid } })

      if (!account) {
        if (traceId)
          console.warn(`[qr-code-sign][${traceId}] account lookup missing`)
        return createError({ statusCode: 400, message: '请求账号不存在' })
      }
      if (traceId)
        console.info(`[qr-code-sign][${traceId}] account lookup complete`)

      const cx = new Cx(account!.info as unknown as CX.User)
      cx.setting = account?.setting as unknown as CX.Setting

      for (const cookieStr of account!.cookies) {
        const cookie = Cookie.fromJSON(cookieStr as object)
        if (cookie) {
          const domain = `https://${cookie.domain}`
          await cx.cookieJar.setCookie(cookie!, domain)
        }
      }

      CXMap.set(uid, cx)
      context.cx = cx
      if (traceId)
        console.info(`[qr-code-sign][${traceId}] account context complete`)
    }
  }
  catch (error: any) {
    if (traceId) {
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNKNOWN_ERROR'
      console.error(`[qr-code-sign][${traceId}] account context failed`, { code })
    }
    else {
      console.log(error)
    }
    return createError({ statusCode: 500, message: error.message })
  }
})
