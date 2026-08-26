import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { captureSessions, archivedSubdirs } from '@main/session/archive'
import { SbxError } from '@shared/errors'

/**
 * A stand-in for the sbx CLI that copies from an in-memory sandbox filesystem onto disk,
 * the way `sbx cp` would. Faked only at the process boundary — everything the archive
 * module actually does (path building, real file writes, pruning) runs for real, so the
 * assertions below are about files that genuinely exist.
 */
function fakeAdapter(sandboxFiles: Record<string, string>, opts: { failOn?: string } = {}) {
  return {
    probeSandboxPath: async (_name: string, path: string): Promise<'dir' | 'file' | 'missing'> => {
      const prefix = path.endsWith('/') ? path : `${path}/`
      if (Object.keys(sandboxFiles).some((f) => f.startsWith(prefix))) return 'dir'
      return Object.hasOwn(sandboxFiles, path) ? 'file' : 'missing'
    },
    copyFromSandbox: async (_name: string, sandboxSrc: string, hostDest: string): Promise<void> => {
      if (opts.failOn && sandboxSrc.includes(opts.failOn)) {
        throw new SbxError('generic', `simulated copy failure for ${sandboxSrc}`)
      }
      // `sbx cp DIR DEST` places the directory itself at the destination.
      const leaf = sandboxSrc.replace(/\/$/, '').split('/').pop() as string
      const prefix = `${sandboxSrc.replace(/\/$/, '')}/`
      for (const [path, body] of Object.entries(sandboxFiles)) {
        if (!path.startsWith(prefix)) continue
        const target = join(hostDest, leaf, path.slice(prefix.length))
        mkdirSync(join(target, '..'), { recursive: true })
        writeFileSync(target, body)
      }
    }
  }
}

const CLAUDE = '/home/agent/.claude'
const PROJECT_DIR = `${CLAUDE}/projects/-c-Experiments-xray`

let base: string
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'sbxmgr-archive-')) })
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

describe('captureSessions', () => {
  it('writes the sandbox transcripts into an archive directory', async () => {
    const adapter = fakeAdapter({
      [`${PROJECT_DIR}/a1b2.jsonl`]: '{"type":"user"}\n{"type":"assistant"}\n'
    })

    const dir = await captureSessions({ adapter }, { sbxName: 'xray-0c6bea75', definitionId: 'def-1', baseDir: base })

    expect(dir).not.toBeNull()
    const restored = join(dir as string, 'projects', '-c-Experiments-xray', 'a1b2.jsonl')
    expect(existsSync(restored)).toBe(true)
    expect(readFileSync(restored, 'utf8')).toBe('{"type":"user"}\n{"type":"assistant"}\n')
  })

  it('returns null when the sandbox has no sessions yet, without throwing', async () => {
    // A never-used sandbox is not a failure — rebuild must proceed exactly as it does today.
    const adapter = fakeAdapter({ [`${CLAUDE}/settings.json`]: '{}' })

    const dir = await captureSessions({ adapter }, { sbxName: 'fresh-1', definitionId: 'def-1', baseDir: base })

    expect(dir).toBeNull()
  })

  it('captures todos alongside the transcripts', async () => {
    const adapter = fakeAdapter({
      [`${PROJECT_DIR}/a1b2.jsonl`]: '{}\n',
      [`${CLAUDE}/todos/a1b2.json`]: '[{"content":"ship it"}]'
    })

    const dir = await captureSessions({ adapter }, { sbxName: 'xray-1', definitionId: 'def-1', baseDir: base })

    expect(existsSync(join(dir as string, 'todos', 'a1b2.json'))).toBe(true)
  })

  it('still succeeds when the sandbox has transcripts but no todos', async () => {
    const adapter = fakeAdapter({ [`${PROJECT_DIR}/a1b2.jsonl`]: '{}\n' })

    const dir = await captureSessions({ adapter }, { sbxName: 'xray-2', definitionId: 'def-1', baseDir: base })

    expect(dir).not.toBeNull()
    expect(existsSync(join(dir as string, 'projects'))).toBe(true)
    expect(existsSync(join(dir as string, 'todos'))).toBe(false)
  })

  it('throws when the transcripts cannot be copied', async () => {
    // instance:rebuild relies on this to abort BEFORE removeSandbox — swallowing the error
    // here would let a rebuild destroy the only copy of the conversations.
    const adapter = fakeAdapter({ [`${PROJECT_DIR}/a1b2.jsonl`]: '{}\n' }, { failOn: 'projects' })

    await expect(
      captureSessions({ adapter }, { sbxName: 'xray-3', definitionId: 'def-1', baseDir: base })
    ).rejects.toThrow(SbxError)
  })

  it('never captures credentials, shell-session keys, or daemon state', async () => {
    const adapter = fakeAdapter({
      [`${PROJECT_DIR}/a1b2.jsonl`]: '{}\n',
      [`${CLAUDE}/.credentials.json`]: '{"token":"SECRET"}',
      [`${CLAUDE}/sessions/1363.json`]: '{}',
      [`${CLAUDE}/daemon.log`]: 'noise'
    })

    const dir = await captureSessions({ adapter }, { sbxName: 'xray-4', definitionId: 'def-1', baseDir: base })

    expect(existsSync(join(dir as string, '.credentials.json'))).toBe(false)
    expect(existsSync(join(dir as string, 'sessions'))).toBe(false)
    expect(existsSync(join(dir as string, 'daemon.log'))).toBe(false)
  })

  it('keeps archives for different definitions apart', async () => {
    const adapter = fakeAdapter({ [`${PROJECT_DIR}/a1b2.jsonl`]: '{}\n' })

    const one = await captureSessions({ adapter }, { sbxName: 'same-name', definitionId: 'def-1', baseDir: base })
    const two = await captureSessions({ adapter }, { sbxName: 'same-name', definitionId: 'def-2', baseDir: base })

    expect(one).not.toBe(two)
    expect(existsSync(one as string)).toBe(true)
    expect(existsSync(two as string)).toBe(true)
  })
})

describe('archivedSubdirs', () => {
  it('reports only the preserved subdirectories the archive actually holds', async () => {
    // Restore emits one `sbx cp` per entry, so naming a directory that is not there would
    // produce a warning on every launch for something that was never captured.
    const adapter = fakeAdapter({ [`${PROJECT_DIR}/a1b2.jsonl`]: '{}\n' })
    const dir = await captureSessions({ adapter }, { sbxName: 'x', definitionId: 'def-1', baseDir: base })

    expect(archivedSubdirs(dir as string)).toEqual(['projects'])
  })

  it('reports both subdirectories when both were captured', async () => {
    const adapter = fakeAdapter({
      [`${PROJECT_DIR}/a1b2.jsonl`]: '{}\n',
      [`${CLAUDE}/todos/a1b2.json`]: '[]'
    })
    const dir = await captureSessions({ adapter }, { sbxName: 'y', definitionId: 'def-1', baseDir: base })

    expect(archivedSubdirs(dir as string)).toEqual(['projects', 'todos'])
  })

  it('returns [] for a directory that does not exist', () => {
    expect(archivedSubdirs(join(base, 'nope'))).toEqual([])
  })
})

describe('captureSessions retention', () => {
  const files = { [`${PROJECT_DIR}/a1b2.jsonl`]: '{}\n' }

  /** Capture at a fixed instant so archive names are deterministic and ordered. */
  const captureAt = (iso: string, sbxName: string) =>
    captureSessions(
      { adapter: fakeAdapter(files) },
      { sbxName, definitionId: 'def-1', baseDir: base, now: () => new Date(iso) }
    )

  it('keeps the three most recent archives and prunes the oldest', async () => {
    const first = await captureAt('2026-08-26T01:00:00Z', 'inst-1')
    const second = await captureAt('2026-08-26T02:00:00Z', 'inst-2')
    const third = await captureAt('2026-08-26T03:00:00Z', 'inst-3')
    const fourth = await captureAt('2026-08-26T04:00:00Z', 'inst-4')

    expect(existsSync(first as string)).toBe(false) // oldest pruned
    for (const kept of [second, third, fourth]) expect(existsSync(kept as string)).toBe(true)
  })

  it('never prunes another definition\'s archives', async () => {
    const other = await captureSessions(
      { adapter: fakeAdapter(files) },
      { sbxName: 'keep-me', definitionId: 'def-2', baseDir: base, now: () => new Date('2026-08-26T00:00:00Z') }
    )
    for (const h of ['01', '02', '03', '04']) await captureAt(`2026-08-26T${h}:00:00Z`, `inst-${h}`)

    expect(existsSync(other as string)).toBe(true)
  })

  it('distinguishes two archives of the same instance taken at different times', async () => {
    // Rebuilds repeat: the same sbxName can be captured more than once and must not overwrite.
    const earlier = await captureAt('2026-08-26T01:00:00Z', 'inst-same')
    const later = await captureAt('2026-08-26T02:00:00Z', 'inst-same')

    expect(earlier).not.toBe(later)
    expect(existsSync(earlier as string)).toBe(true)
    expect(existsSync(later as string)).toBe(true)
  })
})
