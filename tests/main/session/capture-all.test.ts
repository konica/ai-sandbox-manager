import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { captureSessions, ARCHIVE_FILE, SANDBOX_TMP_ARCHIVE } from '@main/session/archive'
import { SbxError } from '@shared/errors'

const CLAUDE = '/home/agent/.claude'

/**
 * Stands in for the sbx CLI. Records the scripts run inside the sandbox so the tar command
 * itself can be asserted, and materialises the copied-out archive on the host.
 */
function fakeAdapter(opts: { hasProjects?: boolean; tarFails?: boolean; copyFails?: boolean } = {}) {
  const scripts: string[] = []
  return {
    scripts,
    probeSandboxPath: async (_n: string, p: string) =>
      (p.endsWith('/projects') && (opts.hasProjects ?? true) ? ('dir' as const) : ('missing' as const)),
    execScript: async (_n: string, script: string) => {
      scripts.push(script)
      if (opts.tarFails && script.includes('tar czf')) throw new SbxError('generic', 'simulated tar failure')
    },
    copyFromSandbox: async (_n: string, src: string, dest: string) => {
      if (opts.copyFails) throw new SbxError('generic', 'simulated copy failure')
      writeFileSync(join(dest, src.split('/').pop() as string), 'TGZ')
    }
  }
}

let base: string
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'sbxmgr-tar-')) })
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

const capture = (adapter: ReturnType<typeof fakeAdapter>) =>
  captureSessions({ adapter }, { sbxName: 'xray-old', definitionId: 'def-1', baseDir: base })

describe('captureSessions archives the whole .claude folder', () => {
  it('writes a single compressed archive into the archive directory', async () => {
    const dir = await capture(fakeAdapter())

    expect(readdirSync(dir as string)).toEqual([ARCHIVE_FILE])
  })

  it('builds the archive inside the sandbox with tar', async () => {
    // One transfer instead of ~740 files, and tar stores symlinks rather than materialising
    // them — which is what made a plain directory copy fail on Windows.
    const adapter = fakeAdapter()

    await capture(adapter)

    const tar = adapter.scripts.find((s) => s.includes('tar czf'))
    expect(tar).toBeDefined()
    expect(tar).toContain(`-C ${CLAUDE}`)
  })

  it('excludes the deleted sandbox\'s own live state', async () => {
    const adapter = fakeAdapter()

    await capture(adapter)

    const tar = adapter.scripts.find((s) => s.includes('tar czf')) as string
    expect(tar).toContain('--exclude=./sessions')
    expect(tar).toContain('--exclude=./daemon.*')
  })

  it('keeps going when an individual file cannot be read', async () => {
    const adapter = fakeAdapter()

    await capture(adapter)

    expect(adapter.scripts.find((s) => s.includes('tar czf'))).toContain('--ignore-failed-read')
  })

  it('removes the temporary archive from inside the sandbox', async () => {
    const adapter = fakeAdapter()

    await capture(adapter)

    expect(adapter.scripts.some((s) => s.includes('rm -f') && s.includes(SANDBOX_TMP_ARCHIVE))).toBe(true)
  })

  it('returns null when the sandbox has no transcripts', async () => {
    const adapter = fakeAdapter({ hasProjects: false })

    expect(await capture(adapter)).toBeNull()
    expect(adapter.scripts.some((s) => s.includes('tar czf'))).toBe(false)
  })

  it('throws when the archive cannot be built', async () => {
    // instance:rebuild relies on this to abort BEFORE removeSandbox.
    await expect(capture(fakeAdapter({ tarFails: true }))).rejects.toThrow(SbxError)
  })

  it('throws when the archive cannot be copied out', async () => {
    await expect(capture(fakeAdapter({ copyFails: true }))).rejects.toThrow(SbxError)
  })
})
