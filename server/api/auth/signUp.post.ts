import { registrationWindow } from '~~/server/utils/registration'

export default defineEventHandler(async (event) => {
  if (!registrationWindow.status().enabled)
    throw createError({ statusCode: 403, message: '网页账户注册已关闭' })

  // const { email, password, code } = await readBody(event) as { email: string; password: string; code: string }
  const { email, password } = await readBody(event) as { email: string; password: string }

  if (!/^([a-zA-Z]|[0-9])(\w|-)+@[a-zA-Z0-9]+\.([a-zA-Z]{2,4})$/.test(email))
    throw createError({ statusMessage: '邮箱格式不正确' })

  const exists = await prisma.user.findUnique({
    where: {
      email,
    },
  })
  if (exists)
    throw createError({ statusMessage: '邮箱已被注册' })

  if (!registrationWindow.status().enabled)
    throw createError({ statusCode: 403, message: '网页账户注册已关闭' })

  const user = await event.context.prisma.user.create({
    data: {
      email,
      name: email,
      password,
    },
  })

  return ResOp.success({ id: user.id, email: user.email, name: user.name })
})
