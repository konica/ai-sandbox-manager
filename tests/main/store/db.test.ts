import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '@main/store/db'

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('metadata-store', () => {
  it('round-trips a definition', () => {
    store.insertDefinition({ id: 'def1', name: 'prj-alpha', description: 'alpha', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
    expect(store.listDefinitions()).toHaveLength(1)
    expect(store.getDefinition('def1')?.name).toBe('prj-alpha')
    expect(store.getDefinition('nope')).toBeNull()
  })

  it('upserts instance metadata by sbx name', () => {
    store.insertDefinition({ id: 'def1', name: 'prj-alpha', description: '', baseImage: 'img', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
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
      definition: { id: 'k1', name: 'k', description: '', baseImage: 'img', tier: 'locked' as const, createdAt: 't' },
      mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }],
      domains: [], ports: [], hostServices: [], credentials: [],
      kitCommandsYaml: 'commands:\n  install: echo hi\n'
    }
    store.insertDefinitionSpec(spec)
    expect(store.getDefinitionSpec('k1')?.kitCommandsYaml).toBe('commands:\n  install: echo hi\n')
    store.updateDefinitionSpec({ ...spec, kitCommandsYaml: 'commands:\n  startup: echo bye\n' })
    expect(store.getDefinitionSpec('k1')?.kitCommandsYaml).toBe('commands:\n  startup: echo bye\n')
  })
})
