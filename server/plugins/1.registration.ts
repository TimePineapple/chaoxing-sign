import { registrationWindow } from '~~/server/utils/registration'

export default defineNitroPlugin(() => {
  try {
    registrationWindow.start(process.env['ALLOW_WEB_REGISTRATION'] === 'true')
  }
  catch {
    // Fail closed if the configured window cannot be recorded in .env.
    console.error('[registration] 未启用网页账户注册：请检查 .env 开关及文件写入权限')
  }
})
