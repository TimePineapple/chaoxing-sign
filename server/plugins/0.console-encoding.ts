import { spawnSync } from 'node:child_process'

export default defineNitroPlugin(() => {
  if (process.platform !== 'win32' || !process.stdout.isTTY)
    return

  try {
    spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'chcp 65001>nul'], {
      stdio: 'ignore',
    })
  }
  catch {
    // Console encoding is best-effort and must never prevent server startup.
  }
})
