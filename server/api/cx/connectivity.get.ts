import { checkCxConnectivity } from '~/server/protocol/cx/connectivity'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  return ResOp.success(await checkCxConnectivity())
})
