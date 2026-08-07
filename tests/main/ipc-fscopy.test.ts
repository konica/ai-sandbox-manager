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
    const probeSandboxPath = vi.fn(async () => 'dir')
    const sandboxTargetsExist = vi.fn(async () => [true])
    const h = buildHandlers(deps({ probeSandboxPath, sandboxTargetsExist }))
    const res = await h['instance:fs:plan']('proj', 'toSandbox', ['C:\\a\\report.csv'], '/workspace', { host: 'C:\\a', sandbox: '/home' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.resolvedDest).toBe('/workspace')
    expect(res.data.items[0]).toEqual({
      source: 'C:\\a\\report.csv', resolvedSource: 'C:\\a\\report.csv',
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
