import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { captureSessions } from '@main/session/archive'

/**
 * Retention behaviour, independent of HOW an archive is built (see capture-all.test.ts for
 * the tar-based capture itself). The adapter is faked at the process boundary; the pruning
 * under test runs against real directories on disk.
 */
function fakeAdapter() {
  return {
    probeSandboxPath: async () => 'dir' as const,
    execScript: async () => {},
    copyFromSandbox: async (_n: string, src: string, dest: string) => {
      writeFileSync(join(dest, src.split('/').pop() as string), 'TGZ')
    }
  }
}

let base: string
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'sbxmgr-archive-')) })
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

describe('captureSessions retention', () => {
  /** Capture at a fixed instant so archive names are deterministic and ordered. */
  const captureAt = (iso: string, sbxName: string) =>
    captureSessions(
      { adapter: fakeAdapter() },
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
      { adapter: fakeAdapter() },
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
