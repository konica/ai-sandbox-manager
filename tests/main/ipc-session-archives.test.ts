import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildHandlers } from '@main/ipc'
import type { DefinitionSpec, InstanceMeta } from '@shared/types'

const SPEC: DefinitionSpec = {
  definition: { id: 'd1', name: 'xray', description: '', agent: 'claude', baseImage: 'img', tier: 'open', createdAt: 't' },
  mounts: [{ hostPath: '/w/xray', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: []
}

let base: string
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'sbxmgr-ipc-arch-')) })
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

function seedArchive(definitionId: string, name: string): string {
  const dir = join(base, 'session-archives', definitionId, name)
  mkdirSync(join(dir, 'projects', '-w-xray'), { recursive: true })
  writeFileSync(join(dir, 'projects', '-w-xray', 'a1b2.jsonl'), '{}\n')
  return dir
}

function harness(over: { linked?: boolean; picked?: string | null } = {}) {
  const linked = over.linked ?? true
  const meta: InstanceMeta[] = linked
    ? [{ sbxName: 'xray-old', definitionId: 'd1', createdByApp: true, createdAt: 't' }]
    : [{ sbxName: 'xray-old', definitionId: null, createdByApp: true, createdAt: 't' }]
  const store = {
    getDefinitionSpec: (id: string) => (id === 'd1' ? SPEC : null),
    getDefinition: (id: string) => (id === 'd1' ? SPEC.definition : null),
    listDefinitions: () => [SPEC.definition],
    listInstanceMeta: () => meta,
    listInstanceTags: () => new Map<string, string[]>()
  }
  const handlers = buildHandlers({
    adapter: { listSandboxes: async () => [] } as never,
    store,
    probes: {} as never,
    openTerminal: () => {},
    sessionArchiveBaseDir: base,
    pickFolder: async () => (over.picked === undefined ? join(base, 'chosen') : over.picked)
  } as never)
  return { handlers }
}

describe('session:listArchives', () => {
  it('lists the instance definition\'s archives, newest first', async () => {
    seedArchive('d1', 'xray-a-2026-08-26T01-00-00-000Z')
    seedArchive('d1', 'xray-b-2026-08-26T02-00-00-000Z')
    const h = harness()

    const res = await h.handlers['session:listArchives']('xray-old')

    expect(res.ok).toBe(true)
    expect(res.ok && res.data.map((a) => a.sbxName)).toEqual(['xray-b', 'xray-a'])
  })

  it('returns an empty list for an instance with no linked definition', async () => {
    seedArchive('d1', 'xray-a-2026-08-26T01-00-00-000Z')
    const h = harness({ linked: false })

    const res = await h.handlers['session:listArchives']('xray-old')

    expect(res.ok).toBe(true)
    expect(res.ok && res.data).toEqual([])
  })

  it('returns an empty list when nothing has been captured yet', async () => {
    const h = harness()

    const res = await h.handlers['session:listArchives']('xray-old')

    expect(res.ok).toBe(true)
    expect(res.ok && res.data).toEqual([])
  })
})

describe('session:exportArchive', () => {
  it('copies the archive into the chosen folder', async () => {
    const src = seedArchive('d1', 'xray-a-2026-08-26T01-00-00-000Z')
    mkdirSync(join(base, 'chosen'), { recursive: true })
    const h = harness()

    const res = await h.handlers['session:exportArchive'](src)

    expect(res.ok).toBe(true)
    const written = res.ok && (res.data as { path?: string }).path
    expect(written).toBeTruthy()
    expect(existsSync(join(written as string, 'projects', '-w-xray', 'a1b2.jsonl'))).toBe(true)
  })

  it('reports cancellation and copies nothing when the picker is dismissed', async () => {
    const src = seedArchive('d1', 'xray-a-2026-08-26T01-00-00-000Z')
    const h = harness({ picked: null })

    const res = await h.handlers['session:exportArchive'](src)

    expect(res.ok).toBe(true)
    expect(res.ok && res.data).toEqual({ canceled: true })
    expect(existsSync(join(base, 'chosen'))).toBe(false)
  })

  it('leaves the original archive in place after exporting', async () => {
    const src = seedArchive('d1', 'xray-a-2026-08-26T01-00-00-000Z')
    mkdirSync(join(base, 'chosen'), { recursive: true })
    const h = harness()

    await h.handlers['session:exportArchive'](src)

    expect(existsSync(join(src, 'projects', '-w-xray', 'a1b2.jsonl'))).toBe(true)
  })
})
