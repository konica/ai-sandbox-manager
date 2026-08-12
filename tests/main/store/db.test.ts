import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openStore, type Store } from '@main/store/db'
import type { DefinitionSpec } from '@shared/types'

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('metadata-store', () => {
  it('round-trips a definition', () => {
    store.insertDefinition({ id: 'def1', name: 'prj-alpha', description: 'alpha', agent: 'claude', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
    expect(store.listDefinitions()).toHaveLength(1)
    expect(store.getDefinition('def1')?.name).toBe('prj-alpha')
    expect(store.getDefinition('nope')).toBeNull()
  })

  it('upserts instance metadata by sbx name', () => {
    store.insertDefinition({ id: 'def1', name: 'prj-alpha', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: 'def1', createdByApp: true, createdAt: '2026-07-18T00:00:00Z' })
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: 'def1', createdByApp: true, createdAt: '2026-07-18T01:00:00Z' })
    const rows = store.listInstanceMeta()
    expect(rows).toHaveLength(1)
    expect(rows[0].createdAt).toBe('2026-07-18T01:00:00Z')
  })

  it('deletes orphaned instance metadata', () => {
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: null, createdByApp: false, createdAt: '2026-07-18T00:00:00Z' })
    store.deleteInstanceMeta('sbx-a')
    expect(store.listInstanceMeta()).toHaveLength(0)
  })

  it('persists and reads kitCommandsYaml on a definition', () => {
    const store = openStore(':memory:')
    const spec = {
      definition: { id: 'k1', name: 'k', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't' },
      mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }],
      domains: [], ports: [], hostServices: [], credentials: [],
      kitCommandsYaml: 'commands:\n  install: echo hi\n'
    }
    store.insertDefinitionSpec(spec)
    expect(store.getDefinitionSpec('k1')?.kitCommandsYaml).toBe('commands:\n  install: echo hi\n')
    store.updateDefinitionSpec({ ...spec, kitCommandsYaml: 'commands:\n  startup: echo bye\n' })
    expect(store.getDefinitionSpec('k1')?.kitCommandsYaml).toBe('commands:\n  startup: echo bye\n')
  })

  it('updateInstanceFingerprint updates only the fingerprint of an existing row', () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'sbx-1', definitionId: null, createdByApp: true, createdAt: 't', credFingerprint: 'old' })
    store.updateInstanceFingerprint('sbx-1', 'new')
    expect(store.listInstanceMeta().find((m) => m.sbxName === 'sbx-1')?.credFingerprint).toBe('new')
    store.close()
  })

  it('updateInstanceFingerprint is a no-op for an unknown sandbox name', () => {
    const store = openStore(':memory:')
    expect(() => store.updateInstanceFingerprint('nope', 'x')).not.toThrow()
    expect(store.listInstanceMeta()).toEqual([])
    store.close()
  })

  it('persists and reads cpus/memory on a definition spec', () => {
    const base = {
      definition: { id: 'r1', name: 'r', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't', cpus: 4, memory: '8g' },
      mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }],
      domains: [], ports: [], hostServices: [], credentials: []
    }
    store.insertDefinitionSpec(base)
    const got = store.getDefinitionSpec('r1')
    expect(got?.definition.cpus).toBe(4)
    expect(got?.definition.memory).toBe('8g')

    store.updateDefinitionSpec({ ...base, definition: { ...base.definition, cpus: 2, memory: '1024m' } })
    const updated = store.getDefinitionSpec('r1')
    expect(updated?.definition.cpus).toBe(2)
    expect(updated?.definition.memory).toBe('1024m')
  })

  it('reads cpus/memory back as undefined when never set', () => {
    const base = {
      definition: { id: 'r2', name: 'r2', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't' },
      mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }],
      domains: [], ports: [], hostServices: [], credentials: []
    }
    store.insertDefinitionSpec(base)
    const got = store.getDefinitionSpec('r2')
    expect(got?.definition.cpus).toBeUndefined()
    expect(got?.definition.memory).toBeUndefined()
  })
})

const mcpBase = (mcp: DefinitionSpec['mcp']): DefinitionSpec => ({
  definition: { id: 'd1', name: 'proj', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: [], copyFiles: [], mcp
})

describe('mcp binding persistence', () => {
  let store: Store
  beforeEach(() => { store = openStore(':memory:') })

  it('round-trips mode + servers for static mode', () => {
    store.insertDefinitionSpec(mcpBase({ mode: 'static', servers: ['github', 'sentry'] }))
    expect(store.getDefinitionSpec('d1')?.mcp).toEqual({ mode: 'static', servers: ['github', 'sentry'] })
  })

  it('round-trips dynamic mode with no servers', () => {
    store.insertDefinitionSpec(mcpBase({ mode: 'dynamic', servers: [] }))
    expect(store.getDefinitionSpec('d1')?.mcp).toEqual({ mode: 'dynamic', servers: [] })
  })

  it('defaults to mode off with no servers when mcp is omitted', () => {
    store.insertDefinitionSpec(mcpBase(undefined))
    expect(store.getDefinitionSpec('d1')?.mcp).toEqual({ mode: 'off', servers: [] })
  })

  it('update replaces the server binding set (delete+reinsert)', () => {
    store.insertDefinitionSpec(mcpBase({ mode: 'static', servers: ['github'] }))
    store.updateDefinitionSpec(mcpBase({ mode: 'static', servers: ['sentry', 'linear'] }))
    expect(store.getDefinitionSpec('d1')?.mcp).toEqual({ mode: 'static', servers: ['sentry', 'linear'] })
  })

  it('update can change mode back to off and clears bindings', () => {
    store.insertDefinitionSpec(mcpBase({ mode: 'static', servers: ['github'] }))
    store.updateDefinitionSpec(mcpBase(undefined))
    expect(store.getDefinitionSpec('d1')?.mcp).toEqual({ mode: 'off', servers: [] })
  })

  it('deleteDefinition cascades mcp_server_binding rows', () => {
    store.insertDefinitionSpec(mcpBase({ mode: 'static', servers: ['github'] }))
    store.deleteDefinition('d1')
    // Re-inserting the same id must not collide with leftover binding rows.
    expect(() => store.insertDefinitionSpec(mcpBase({ mode: 'static', servers: ['sentry'] }))).not.toThrow()
    expect(store.getDefinitionSpec('d1')?.mcp).toEqual({ mode: 'static', servers: ['sentry'] })
  })
})

describe('v11 -> v12 mcp migration', () => {
  it('migrates a pre-mcp (v11) DB with no data loss: existing definitions get mode off, no bindings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbx-db-'))
    const file = join(dir, 'test.db')
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE definition (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        base_image TEXT NOT NULL,
        agent TEXT NOT NULL DEFAULT 'claude',
        tier TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ssh_forward_agent INTEGER NOT NULL DEFAULT 1,
        ssh_commit_signing INTEGER NOT NULL DEFAULT 0,
        kit_commands_yaml TEXT
      );
      CREATE TABLE mount_intent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        definition_id TEXT NOT NULL,
        host_path TEXT NOT NULL,
        mode TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0
      );
      PRAGMA user_version = 11;
    `)
    raw.prepare(
      `INSERT INTO definition (id, name, description, base_image, agent, tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('d1', 'Proj', '', 'img', 'claude', 'locked', 't')
    raw.prepare(
      `INSERT INTO mount_intent (definition_id, host_path, mode, is_primary) VALUES (?, ?, ?, ?)`
    ).run('d1', '/w', 'direct', 1)
    raw.close()

    const migrated = openStore(file)
    expect(migrated.getDefinitionSpec('d1')?.mcp).toEqual({ mode: 'off', servers: [] })
    expect(migrated.getDefinitionSpec('d1')?.mounts).toEqual([{ hostPath: '/w', mode: 'direct', isPrimary: true }])
    migrated.close()
  })

  it('is idempotent across repeated opens of an already-migrated database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbx-db-'))
    const file = join(dir, 'test.db')

    const store1 = openStore(file)
    store1.insertDefinitionSpec(mcpBase({ mode: 'static', servers: ['github'] }))
    store1.close()

    expect(() => {
      const store2 = openStore(file)
      expect(store2.getDefinitionSpec('d1')?.mcp).toEqual({ mode: 'static', servers: ['github'] })
      store2.close()
    }).not.toThrow()
  })

  it('a fresh DB migrates to v12 with mcp columns present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbx-db-'))
    const file = join(dir, 'test.db')
    const fresh = openStore(file)
    fresh.insertDefinitionSpec(mcpBase(undefined))
    expect(fresh.getDefinitionSpec('d1')?.mcp).toEqual({ mode: 'off', servers: [] })
    fresh.close()

    const raw = new Database(file)
    expect((raw.pragma('user_version') as Array<{ user_version: number }>)[0].user_version).toBe(12)
    raw.close()
  })
})
