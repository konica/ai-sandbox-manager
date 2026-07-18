import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '@main/store/db'
import type { DefinitionSpec } from '@shared/types'

let store: Store
beforeEach(() => { store = openStore(':memory:') })

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'prj-alpha', description: 'Alpha service', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' },
  mounts: [
    { hostPath: '/home/u/alpha', mode: 'direct', isPrimary: true },
    { hostPath: '/home/u/shared', mode: 'clone', isPrimary: false }
  ],
  domains: ['api.github.com', 'registry.npmjs.org'],
  ports: [{ hostPort: 8080, containerPort: 3000, label: 'web' }],
  credentials: [{ label: 'GitHub token', kind: 'git' }]
}

describe('definition spec persistence', () => {
  it('round-trips a full spec', () => {
    store.insertDefinitionSpec(spec)
    const got = store.getDefinitionSpec('d1')
    expect(got).toEqual(spec)
  })

  it('returns null for an unknown id', () => {
    expect(store.getDefinitionSpec('missing')).toBeNull()
  })

  it('lists the definition base row alongside instance metadata queries', () => {
    store.insertDefinitionSpec(spec)
    expect(store.listDefinitions().map((d) => d.id)).toContain('d1')
  })

  it('persists an empty-children spec', () => {
    const bare: DefinitionSpec = {
      definition: { id: 'd2', name: 'bare', description: '', baseImage: 'docker/sandbox-templates:claude-code', tier: 'open', createdAt: '2026-07-18T00:00:00Z' },
      mounts: [], domains: [], ports: [], credentials: []
    }
    store.insertDefinitionSpec(bare)
    expect(store.getDefinitionSpec('d2')).toEqual(bare)
  })
})
