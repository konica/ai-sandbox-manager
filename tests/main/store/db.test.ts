import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '@main/store/db'

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

  it('persists and reads diskSize on a definition spec', () => {
    const store = openStore(':memory:')
    const spec = {
      definition: { id: 'ds1', name: 'ds', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't', diskSize: '30g' },
      mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }],
      domains: [], ports: [], hostServices: [], credentials: []
    }
    store.insertDefinitionSpec(spec)
    expect(store.getDefinitionSpec('ds1')?.definition.diskSize).toBe('30g')
    store.updateDefinitionSpec({ ...spec, definition: { ...spec.definition, diskSize: '80g' } })
    expect(store.getDefinitionSpec('ds1')?.definition.diskSize).toBe('80g')
    store.close()
  })

  it('leaves diskSize undefined when absent', () => {
    const store = openStore(':memory:')
    store.insertDefinition({ id: 'ds2', name: 'ds2', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' })
    expect(store.getDefinition('ds2')?.diskSize).toBeUndefined()
    store.close()
  })

  it('round-trips diskSize on instance metadata', () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'sbx-d', definitionId: null, createdByApp: true, createdAt: 't', diskSize: '20g' })
    expect(store.listInstanceMeta().find((m) => m.sbxName === 'sbx-d')?.diskSize).toBe('20g')
    // overwrite via ON CONFLICT
    store.upsertInstanceMeta({ sbxName: 'sbx-d', definitionId: null, createdByApp: true, createdAt: 't2', diskSize: '40g' })
    expect(store.listInstanceMeta().find((m) => m.sbxName === 'sbx-d')?.diskSize).toBe('40g')
    store.close()
  })

  it('reads diskSize as undefined when never set', () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'sbx-n', definitionId: null, createdByApp: true, createdAt: 't' })
    expect(store.listInstanceMeta().find((m) => m.sbxName === 'sbx-n')?.diskSize).toBeUndefined()
    store.close()
  })
})
