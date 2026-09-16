// Run after `pnpm run build`. Uses fake configuration and local proxy fixtures only.
// Keeps its isolated temporary directory for inspection; never deletes project files.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const source = resolve(process.argv[2] || '.output')
const isolated = mkdtempSync(join(tmpdir(), 'chaoxing-proxy-build-'))
const output = join(isolated, '.output')
cpSync(source, output, { recursive: true, dereference: true })
const files = readdirSync(join(output, 'server', 'chunks'), { recursive: true })
const cxRelative = files.find(name => name.endsWith('.mjs')
  && /class Cx\s*\{/.test(readFileSync(join(output, 'server', 'chunks', name), 'utf8')))
assert.ok(cxRelative, 'Compiled Cx class must be present')
const cxPath = join(output, 'server', 'chunks', cxRelative)
const hashBefore = createHash('sha256').update(readFileSync(cxPath)).digest('hex')
const childPath = join(isolated, 'check-cx.mjs')
writeFileSync(childPath, `
import { pathToFileURL } from 'node:url';
const module = await import(pathToFileURL(process.argv[2]).href);
const Cx = Object.values(module).find(value => typeof value === 'function' && value.prototype?.login && value.prototype?.getCourseList);
if (!Cx) throw new Error('Cx export missing');
const cx = new Cx({});
const result = await cx.http.get('http://fixture.invalid/check', {retry:{limit:0},timeout:{request:3000}}).json();
console.log('CX_PROXY_RESULT=' + JSON.stringify(result));
`)

// No source-directory NODE_PATH or real application settings reach the child.
const cleanEnv = {
  PATH: dirname(process.execPath),
  SystemRoot: process.env.SystemRoot,
  TEMP: tmpdir(),
  TMP: tmpdir(),
  NODE_ENV: 'production',
}
const proxies = []
const children = new Set()
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

async function runChild(args, verify) {
  const child = spawn(process.execPath, args, { cwd: isolated, env: cleanEnv, windowsHide: true })
  children.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => { children.delete(child); resolve(code) })
  })
  const timer = setTimeout(() => child.kill(), 20000)
  try {
    if (verify) {
      await verify(() => stdout, child)
      child.kill()
      await exit
    }
    else {
      const code = await exit
      assert.equal(code, 0, `Child failed: ${stderr}`)
    }
    return stdout
  }
  finally {
    clearTimeout(timer)
    if (children.has(child)) {
      child.kill()
      await exit
    }
  }
}

try {
  for (const id of ['proxy-A', 'proxy-B']) {
    let requests = 0
    const proxy = http.createServer((_req, res) => {
      requests++
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id }))
    })
    proxies.push(proxy)
    const proxyPort = await listen(proxy)
    const reserved = http.createServer()
    const appPort = await listen(reserved)
    await new Promise(resolve => reserved.close(resolve))
    writeFileSync(join(isolated, '.env'), [
      `CX_PROXY_URL=http://127.0.0.1:${proxyPort}`,
      `PORT=${appPort}`, 'HOST=127.0.0.1',
      'NUXT_IM_INIT_CONNECT=false', 'AUTH_SECRET=isolated-test-secret',
      `AUTH_ORIGIN=http://127.0.0.1:${appPort}`, `NEXTAUTH_URL=http://127.0.0.1:${appPort}`,
      'DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture', '',
    ].join('\n'))
    const result = await runChild(['--env-file=.env', childPath, cxPath])
    assert.ok(result.includes(`CX_PROXY_RESULT={"id":"${id}"}`), result)
    assert.equal(requests, 1, 'Exactly one request must pass through the selected proxy')

    await runChild(['--env-file=.env', join(output, 'server', 'index.mjs')], async (stdout, child) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error('Built server exited before listening')
        if (stdout().includes('Listening on')) {
          const response = await fetch(`http://127.0.0.1:${appPort}/api/auth/session`)
          assert.equal(response.status, 200)
          return
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('Built server did not listen in time')
    })
    console.log(`${id}: compiled Cx proxy request and isolated server startup passed`)
  }
  assert.equal(createHash('sha256').update(readFileSync(cxPath)).digest('hex'), hashBefore)
  console.log('PASS: same build, two runtime .env configurations, no source node_modules')
  console.log(`Isolated artifacts retained at: ${isolated}`)
}
finally {
  for (const child of children) child.kill()
  for (const proxy of proxies) {
    proxy.closeAllConnections()
    await new Promise(resolve => proxy.close(resolve))
  }
}
