import { CXMap } from '~~/server/protocol/cx'
import { IMConnectionMap } from '~~/server/protocol/easemob'

export default defineEventHandler(async (event) => {
  const uid = event.context.cx?.user?.uid
  const currentCx = event.context.cx

  await event.context.cx?.logout()

  CXMap.delete(uid)
  for (const [key, cx] of CXMap) {
    if (cx === currentCx || String(cx.user.uid) === String(uid))
      CXMap.delete(key)
  }
  if (IMConnectionMap.has(uid)) {
    IMConnectionMap.get(uid)?.close()
    IMConnectionMap.delete(uid)
  }

  await event.context.prisma.cxAccount.delete({
    where: {
      uid,
    },
  })

  return new ResOp(200, null, '退出成功')
})
