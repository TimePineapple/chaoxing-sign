import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const serverEntry = resolve('.output/server/index.mjs')
const directory = mkdtempSync(join(tmpdir(), 'chaoxing-registration-built-'))
const envPath = join(directory, '.env')

async function freePort() {
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  return port
}

async function runCase(enabled) {
  const port = await freePort()
  writeFileSync(envPath, `NITRO_PORT=${port}\nAUTH_ORIGIN=http://127.0.0.1:${port}\nNEXTAUTH_URL=http://127.0.0.1:${port}\nAUTH_SECRET=registration-smoke-test\nDATABASE_URL=postgresql://fixture:fixture@127.0.0.1:5432/fixture\nNUXT_IM_INIT_CONNECT=false\nALLOW_WEB_REGISTRATION=${enabled}\n`)
  const env = { ...process.env, NITRO_PORT: String(port) }
  delete env.ALLOW_WEB_REGISTRATION
  const child = spawn(process.execPath, ['--env-file=.env', serverEntry], {
    cwd: directory,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  const closed = new Promise(resolve => child.once('close', resolve))
  let output = ''
  child.stdout.on('data', chunk => output += chunk)
  child.stderr.on('data', chunk => output += chunk)
  try {
    let response
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null)
        throw new Error(`Server exited early: ${output.slice(-2000)}`)
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/auth/registration-status`)
        break
      }
      catch {
        await delay(100)
      }
    }
    assert.ok(response, `Server did not start: ${output.slice(-2000)}`)
    assert.equal(response.status, 200)
    const status = await response.json()
    assert.equal(status.enabled, enabled)
    assert.equal(Boolean(status.expiresAt), enabled)

    if (enabled) {
      assert.match(readFileSync(envPath, 'utf8'), /^ALLOW_WEB_REGISTRATION=true # expiresAt=\d{13}$/m)
    }
    else {
      const signup = await fetch(`http://127.0.0.1:${port}/api/auth/signUp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'example@example.com', password: 'fixture' }),
      })
      assert.equal(signup.status, 403)
      assert.match(await signup.text(), /网页账户注册已关闭/)
    }
  }
  finally {
    child.kill()
    await closed
  }
}

try {
  await runCase(false)
  await runCase(true)
  console.log('Built registration smoke test passed')
}
finally {
  unlinkSync(envPath)
  rmdirSync(directory)
}
