import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResOp } from '../server/utils'

vi.mock('~~/server/protocol/cx', () => ({
  CXMap: new Map(),
  CxLoginError: class extends Error {},
  Cx: class {
    user = { uid: 'cx-fixed', username: 'student', password: 'secret', realname: 'Student', logged: true }
    async login() { return 'ok' }
    getCookie() { return [] }
  },
}))

let handler: any

function fixture(ownerId: string) {
  const existing = { uid: 'cx-fixed', username: 'student', password: 'secret', lastLoginTime: new Date(), info: {} }
  const prisma = { cxAccount: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue(existing),
    findUniqueOrThrow: vi.fn().mockResolvedValue(existing),
  } }
  return { prisma, event: { session: { uid: ownerId }, body: { username: 'student', password: 'secret' }, context: { prisma } } }
}

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('readBody', (event: any) => Promise.resolve(event.body))
  vi.stubGlobal('createError', ({ statusCode, message }: { statusCode: number; message: string }) => Object.assign(new Error(message), { statusCode }))
  vi.stubGlobal('ResOp', ResOp)
  handler = (await import('../server/api/cx/login.post')).default
})

describe('learning account ownership', () => {
  it('does not transfer a globally unique UID to a second website account', async () => {
    const { prisma, event } = fixture('web-b')
    prisma.cxAccount.create.mockRejectedValue({ code: 'P2002' })
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.cxAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { uid: 'cx-fixed', userId: 'web-b' } }))
    expect(prisma.cxAccount.create).toHaveBeenCalledTimes(1)
    expect(prisma.cxAccount.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it('updates a learning account already owned by this website user', async () => {
    const { prisma, event } = fixture('web-a')
    prisma.cxAccount.updateMany.mockResolvedValue({ count: 1 })
    const response = await handler(event)
    expect(response).toMatchObject({ code: 200, data: { uid: 'cx-fixed' } })
    expect(prisma.cxAccount.create).not.toHaveBeenCalled()
  })
})
