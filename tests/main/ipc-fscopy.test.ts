import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '@main/ipc'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

function deps(adapter: Record<string, unknown>) {
  return { adapter: adapter as never, store: {} as never, probes: {} as never, openTerminal: () => {} }
}

describe('instance:fs:listDir', () => {
  it('delegates to the adapter', async () => {
    const listSandboxDir = vi.fn(async () => ({ ok: true, cwd: '/workspace', entries: [] }))
    const h = buildHandlers(deps({ listSandboxDir }))
    const res = await h['instance:fs:listDir']('proj', '/workspace')
    expect(res.ok && res.data).toEqual({ ok: true, cwd: '/workspace', entries: [] })
    expect(listSandboxDir).toHaveBeenCalledWith('proj', '/workspace')
  })
})

describe('instance:fs:plan (host → sandbox)', () => {
  it('resolves paths and flags overwrites when the target exists', async () => {
    // resolveHostPath treats an already-absolute source as absolute using node:path's
    // *platform-native* isAbsolute/resolve — which is correct, since the host paths a real
    // user passes in are always native to whatever OS this app is running on (this app ships
    // separate Windows/macOS/Linux builds; a Windows host never hands it a POSIX path or vice
    // versa). So the fixture path must be absolute on whichever platform the test itself runs
    // on, or a Linux CI runner sees 'C:\a\report.csv' as relative and prepends its cwd.
    const hostAbsPath = process.platform === 'win32' ? 'C:\\a\\report.csv' : '/a/report.csv'
    const hostDefaultDir = process.platform === 'win32' ? 'C:\\a' : '/a'
    const probeSandboxPath = vi.fn(async () => 'dir')
    const sandboxTargetsExist = vi.fn(async () => [true])
    const h = buildHandlers(deps({ probeSandboxPath, sandboxTargetsExist }))
    const res = await h['instance:fs:plan']('proj', 'toSandbox', [hostAbsPath], '/workspace', { host: hostDefaultDir, sandbox: '/home' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.resolvedDest).toBe('/workspace')
    expect(res.data.items[0]).toEqual({
      source: hostAbsPath, resolvedSource: hostAbsPath,
      target: '/workspace/report.csv', willOverwrite: true
    })
    expect(sandboxTargetsExist).toHaveBeenCalledWith('proj', ['/workspace/report.csv'])
  })
})

describe('instance:fs:plan (sandbox → host)', () => {
  it('checks host destination existence for overwrite', async () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'fscopy-'))
    fs.writeFileSync(join(dir, 'out.log'), 'x')
    const h = buildHandlers(deps({}))
    const res = await h['instance:fs:plan']('proj', 'fromSandbox', ['/workspace/out.log'], dir, { host: 'C:\\dl', sandbox: '/workspace' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.items[0].target).toBe(join(dir, 'out.log'))
    expect(res.data.items[0].willOverwrite).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('instance:fs:plan (tilde expansion)', () => {
  it('expands a bare `~` sandbox dest to /home/agent and probes/targets accordingly', async () => {
    const probeSandboxPath = vi.fn(async () => 'dir')
    const sandboxTargetsExist = vi.fn(async () => [false])
    const h = buildHandlers(deps({ probeSandboxPath, sandboxTargetsExist }))
    const res = await h['instance:fs:plan']('proj', 'toSandbox', ['C:\\a\\report.csv'], '~', { host: 'C:\\a', sandbox: '/home' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.resolvedDest).toBe('/home/agent')
    expect(res.data.items[0].target).toBe('/home/agent/report.csv')
    expect(probeSandboxPath).toHaveBeenCalledWith('proj', '/home/agent')
    expect(sandboxTargetsExist).toHaveBeenCalledWith('proj', ['/home/agent/report.csv'])
  })

  it('expands `~/out` sandbox dest to /home/agent/out', async () => {
    const probeSandboxPath = vi.fn(async () => 'dir')
    const sandboxTargetsExist = vi.fn(async () => [false])
    const h = buildHandlers(deps({ probeSandboxPath, sandboxTargetsExist }))
    const res = await h['instance:fs:plan']('proj', 'toSandbox', ['C:\\a\\report.csv'], '~/out', { host: 'C:\\a', sandbox: '/home' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.resolvedDest).toBe('/home/agent/out')
  })

  it('expands a bare `~` host dest to the OS home dir', async () => {
    const h = buildHandlers(deps({}))
    const res = await h['instance:fs:plan']('proj', 'fromSandbox', ['/workspace/out.log'], '~', { host: 'C:\\dl', sandbox: '/workspace' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.resolvedDest).toBe(os.homedir())
  })
})

describe('instance:fs:listDir (tilde expansion)', () => {
  it('expands `~` before calling the adapter', async () => {
    const listSandboxDir = vi.fn(async () => ({ ok: true, cwd: '/home/agent', entries: [] }))
    const h = buildHandlers(deps({ listSandboxDir }))
    await h['instance:fs:listDir']('proj', '~')
    expect(listSandboxDir).toHaveBeenCalledWith('proj', '/home/agent')
  })
})

describe('instance:fs:copy', () => {
  it('copies each source and reports per-item results without aborting', async () => {
    const copyToSandbox = vi.fn(async (_n: string, src: string) => {
      if (src.includes('bad')) throw Object.assign(new Error('no such file'), { kind: 'generic' })
    })
    const h = buildHandlers(deps({ copyToSandbox }))
    const res = await h['instance:fs:copy']('proj', 'toSandbox', ['C:\\good.txt', 'C:\\bad.txt'], '/workspace')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data).toEqual([
      { source: 'C:\\good.txt', ok: true },
      { source: 'C:\\bad.txt', ok: false, error: 'no such file' }
    ])
  })
})
