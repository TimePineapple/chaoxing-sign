import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RegistrationWindow } from './registration'

const startTime = Date.UTC(2026, 8, 16, 12)
let directory: string
let envPath: string

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(startTime)
  directory = mkdtempSync(join(tmpdir(), 'chaoxing-registration-'))
  envPath = join(directory, '.env')
})

afterEach(() => {
  vi.useRealTimers()
  try { unlinkSync(envPath) }
  catch { /* A test may intentionally leave the file absent. */ }
  rmdirSync(directory)
})

describe('website registration window', () => {
  it('stays closed by default, even if the file is edited while running', () => {
    writeFileSync(envPath, 'ALLOW_WEB_REGISTRATION=false\n')
    const window = new RegistrationWindow(envPath)
    window.start(false)
    writeFileSync(envPath, 'ALLOW_WEB_REGISTRATION=true\n')
    expect(window.status()).toEqual({ enabled: false, expiresAt: null })
  })

  it('allows multiple registrations for five minutes and restores only the switch line', () => {
    writeFileSync(envPath, 'DATABASE_URL="fixture"\r\nALLOW_WEB_REGISTRATION=true\r\nCX_PROXY_URL=\r\n')
    const window = new RegistrationWindow(envPath)
    window.start(true)
    const expiresAt = new Date(startTime + 300_000).toISOString()
    expect(window.status()).toEqual({ enabled: true, expiresAt })
    expect(window.status()).toEqual({ enabled: true, expiresAt })
    expect(readFileSync(envPath, 'utf8')).toContain(`ALLOW_WEB_REGISTRATION=true # expiresAt=${startTime + 300_000}\r\n`)

    vi.advanceTimersByTime(299_999)
    expect(window.status().enabled).toBe(true)
    vi.advanceTimersByTime(1)
    expect(window.status()).toEqual({ enabled: false, expiresAt: null })
    expect(readFileSync(envPath, 'utf8')).toBe('DATABASE_URL="fixture"\r\nALLOW_WEB_REGISTRATION=false\r\nCX_PROXY_URL=\r\n')
  })

  it('does not extend the deadline on restart', () => {
    writeFileSync(envPath, 'ALLOW_WEB_REGISTRATION=true\n')
    const first = new RegistrationWindow(envPath)
    first.start(true)
    vi.advanceTimersByTime(120_000)

    const restarted = new RegistrationWindow(envPath)
    restarted.start(true)
    expect(restarted.status().expiresAt).toBe(new Date(startTime + 300_000).toISOString())
    vi.advanceTimersByTime(180_000)
    expect(restarted.status().enabled).toBe(false)
    expect(readFileSync(envPath, 'utf8')).toBe('ALLOW_WEB_REGISTRATION=false\n')
  })

  it('keeps the switch parseable by node --env-file after recording its deadline', () => {
    writeFileSync(envPath, 'ALLOW_WEB_REGISTRATION=true\n')
    new RegistrationWindow(envPath).start(true)
    const env = { ...process.env }
    delete env.ALLOW_WEB_REGISTRATION
    const result = spawnSync(process.execPath, [`--env-file=${envPath}`, '-p', 'process.env.ALLOW_WEB_REGISTRATION'], {
      env,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('true')
  })

  it('closes a window that expired while the service was offline', () => {
    writeFileSync(envPath, `ALLOW_WEB_REGISTRATION=true # expiresAt=${startTime - 1}\n`)
    const window = new RegistrationWindow(envPath)
    window.start(true)
    expect(window.status().enabled).toBe(false)
    expect(readFileSync(envPath, 'utf8')).toBe('ALLOW_WEB_REGISTRATION=false\n')
  })

  it('fails closed when the file is missing or the switch is malformed', () => {
    const missing = new RegistrationWindow(envPath)
    expect(() => missing.start(true)).toThrow()
    expect(missing.status().enabled).toBe(false)

    writeFileSync(envPath, 'ALLOW_WEB_REGISTRATION=yes\n')
    const malformed = new RegistrationWindow(envPath)
    expect(() => malformed.start(true)).toThrow()
    expect(malformed.status().enabled).toBe(false)
    expect(readFileSync(envPath, 'utf8')).toBe('ALLOW_WEB_REGISTRATION=yes\n')
  })
})
