import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REGISTRATION_WINDOW_MS = 5 * 60 * 1000
const registrationLine = /^(\uFEFF?[ \t]*)ALLOW_WEB_REGISTRATION[ \t]*=[ \t]*(true|false)(?:[ \t]*#[ \t]*expiresAt=(\d{13}))?[ \t]*$/

interface RegistrationLine {
  parts: string[]
  index: number
  indent: string
  enabled: boolean
  expiresAt?: number
}

function readRegistrationLine(path: string): RegistrationLine {
  // Keep the original separators so unrelated .env lines remain byte-for-byte intact.
  const parts = readFileSync(path, 'utf8').split(/(\r\n|\n|\r)/)
  const matches = parts.flatMap((line, index) => {
    if (index % 2)
      return []
    const match = registrationLine.exec(line)
    return match ? [{ index, match }] : []
  })
  if (matches.length !== 1)
    throw new Error('ALLOW_WEB_REGISTRATION must appear once as true or false in .env')

  const { index, match } = matches[0]
  return {
    parts,
    index,
    indent: match[1],
    enabled: match[2] === 'true',
    expiresAt: match[3] ? Number(match[3]) : undefined,
  }
}

function writeRegistrationLine(path: string, line: RegistrationLine, enabled: boolean, expiresAt?: number) {
  line.parts[line.index] = `${line.indent}ALLOW_WEB_REGISTRATION=${enabled}${expiresAt ? ` # expiresAt=${expiresAt}` : ''}`
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, line.parts.join(''), { flag: 'wx', mode: statSync(path).mode })
    renameSync(temporaryPath, path)
  }
  catch (error) {
    try { unlinkSync(temporaryPath) }
    catch { /* The temporary file was not created or was already moved. */ }
    throw error
  }
}

export class RegistrationWindow {
  private started = false
  private expiresAt: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly envPath: string) {}

  start(enabledAtStartup: boolean, now = Date.now()) {
    if (this.started)
      return
    this.started = true
    if (!enabledAtStartup)
      return

    const line = readRegistrationLine(this.envPath)
    if (!line.enabled)
      return

    const expiresAt = line.expiresAt ?? now + REGISTRATION_WINDOW_MS
    if (!line.expiresAt)
      writeRegistrationLine(this.envPath, line, true, expiresAt)

    if (now >= expiresAt) {
      this.disable()
      return
    }

    this.expiresAt = expiresAt
    this.timer = setTimeout(() => this.disable(), expiresAt - now)
    this.timer.unref?.()
  }

  status(now = Date.now()) {
    if (this.expiresAt !== null && now >= this.expiresAt)
      this.disable()

    return {
      enabled: this.expiresAt !== null,
      expiresAt: this.expiresAt === null ? null : new Date(this.expiresAt).toISOString(),
    }
  }

  private disable() {
    this.expiresAt = null
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      const line = readRegistrationLine(this.envPath)
      if (line.enabled)
        writeRegistrationLine(this.envPath, line, false)
    }
    catch {
      // The in-memory gate remains closed; the persisted expiry prevents reopening on restart.
      console.error('[registration] 无法将 .env 注册开关写回 false，请检查文件权限')
    }
  }
}

export const registrationWindow = new RegistrationWindow(resolve(process.cwd(), '.env'))
