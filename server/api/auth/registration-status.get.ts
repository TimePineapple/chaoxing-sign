import { registrationWindow } from '~~/server/utils/registration'

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  return registrationWindow.status()
})
