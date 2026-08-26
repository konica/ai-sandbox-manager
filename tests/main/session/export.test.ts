import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listArchives, exportArchive } from '@main/session/archive'

let base: string
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'sbxmgr-export-')) })
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

/** Write an archive on disk exactly as captureSessions lays one out. */
function seedArchive(definitionId: string, name: string, body = '{"type":"user"}\n'): string {
  const dir = join(base, 'session-archives', definitionId, name)
  mkdirSync(join(dir, 'projects', '-w-xray'), { recursive: true })
  writeFileSync(join(dir, 'projects', '-w-xray', 'a1b2.jsonl'), body)
  return dir
}

describe('listArchives', () => {
  it('lists a definition\'s archives newest first', () => {
    seedArchive('def-1', 'xray-a-2026-08-26T01-00-00-000Z')
    seedArchive('def-1', 'xray-c-2026-08-26T03-00-00-000Z')
    seedArchive('def-1', 'xray-b-2026-08-26T02-00-00-000Z')

    const found = listArchives(base, 'def-1')

    expect(found.map((a) => a.sbxName)).toEqual(['xray-c', 'xray-b', 'xray-a'])
  })

  it('exposes the capture time parsed from the directory name', () => {
    seedArchive('def-1', 'xray-a-2026-08-26T01-00-00-000Z')

    const [only] = listArchives(base, 'def-1')

    expect(only.capturedAt).toBe('2026-08-26T01:00:00.000Z')
  })

  it('returns only the requested definition\'s archives', () => {
    seedArchive('def-1', 'mine-2026-08-26T01-00-00-000Z')
    seedArchive('def-2', 'theirs-2026-08-26T02-00-00-000Z')

    expect(listArchives(base, 'def-1').map((a) => a.sbxName)).toEqual(['mine'])
  })

  it('returns [] when the definition has no archives', () => {
    expect(listArchives(base, 'never-captured')).toEqual([])
  })

  it('returns [] rather than throwing when the archive root does not exist', () => {
    expect(listArchives(join(base, 'no-such-dir'), 'def-1')).toEqual([])
  })
})

describe('exportArchive', () => {
  it('copies the whole archive tree into the chosen folder', () => {
    const src = seedArchive('def-1', 'xray-a-2026-08-26T01-00-00-000Z', 'TRANSCRIPT\n')
    const dest = join(base, 'chosen')
    mkdirSync(dest, { recursive: true })

    const written = exportArchive(src, dest)

    const copied = join(written, 'projects', '-w-xray', 'a1b2.jsonl')
    expect(existsSync(copied)).toBe(true)
    expect(readFileSync(copied, 'utf8')).toBe('TRANSCRIPT\n')
  })

  it('leaves the original archive in place', () => {
    // Export is a copy, not a move: the archive is still the rebuild safety net.
    const src = seedArchive('def-1', 'xray-a-2026-08-26T01-00-00-000Z')
    const dest = join(base, 'chosen')
    mkdirSync(dest, { recursive: true })

    exportArchive(src, dest)

    expect(existsSync(join(src, 'projects', '-w-xray', 'a1b2.jsonl'))).toBe(true)
  })

  it('names the exported folder after the archive so two exports do not merge', () => {
    const a = seedArchive('def-1', 'xray-a-2026-08-26T01-00-00-000Z', 'A\n')
    const b = seedArchive('def-1', 'xray-b-2026-08-26T02-00-00-000Z', 'B\n')
    const dest = join(base, 'chosen')
    mkdirSync(dest, { recursive: true })

    const outA = exportArchive(a, dest)
    const outB = exportArchive(b, dest)

    expect(outA).not.toBe(outB)
    expect(readFileSync(join(outA, 'projects', '-w-xray', 'a1b2.jsonl'), 'utf8')).toBe('A\n')
    expect(readFileSync(join(outB, 'projects', '-w-xray', 'a1b2.jsonl'), 'utf8')).toBe('B\n')
  })

  it('copies todos too when the archive has them', () => {
    const src = seedArchive('def-1', 'xray-a-2026-08-26T01-00-00-000Z')
    mkdirSync(join(src, 'todos'), { recursive: true })
    writeFileSync(join(src, 'todos', 'a1b2.json'), '[]')
    const dest = join(base, 'chosen')
    mkdirSync(dest, { recursive: true })

    const written = exportArchive(src, dest)

    expect(existsSync(join(written, 'todos', 'a1b2.json'))).toBe(true)
  })
})
