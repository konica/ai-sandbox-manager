import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '../../../src/main/store/db'
import { applyPortEdit, applyHostServiceEdit, applyDomainEdit } from '../../../src/main/detail/persist'
import type { DefinitionSpec } from '../../../src/shared/types'

function seed(store: Store): void {
  const spec: DefinitionSpec = {
    definition: { id: 'd1', name: 'P', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
  }
  store.insertDefinitionSpec(spec)
  store.upsertInstanceMeta({ sbxName: 'box', definitionId: 'd1', createdByApp: true, createdAt: 't' })
}

let store: Store
beforeEach(() => { store = openStore(':memory:'); seed(store) })

describe('dual-write persist', () => {
  it('adds then removes a port on the definition', () => {
    expect(applyPortEdit(store, 'box', { hostPort: 8080, containerPort: 3000, protocol: 'tcp' }, 'add')).toBe(true)
    expect(store.getDefinitionSpec('d1')!.ports).toEqual([{ hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: '' }])
    applyPortEdit(store, 'box', { hostPort: 8080, containerPort: 3000, protocol: 'tcp' }, 'remove')
    expect(store.getDefinitionSpec('d1')!.ports).toEqual([])
  })
  it('adds then removes a host service', () => {
    applyHostServiceEdit(store, 'box', { hostPort: 11434, label: 'Ollama' }, 'add')
    expect(store.getDefinitionSpec('d1')!.hostServices).toEqual([{ hostPort: 11434, label: 'Ollama' }])
    applyHostServiceEdit(store, 'box', { hostPort: 11434, label: '' }, 'remove')
    expect(store.getDefinitionSpec('d1')!.hostServices).toEqual([])
  })
  it('adds then removes a domain', () => {
    applyDomainEdit(store, 'box', 'api.example.com', 'add')
    expect(store.getDefinitionSpec('d1')!.domains).toEqual(['api.example.com'])
    applyDomainEdit(store, 'box', 'api.example.com', 'remove')
    expect(store.getDefinitionSpec('d1')!.domains).toEqual([])
  })
  it('dedupes an add (no duplicate ports/domains)', () => {
    applyDomainEdit(store, 'box', 'x.com', 'add')
    applyDomainEdit(store, 'box', 'x.com', 'add')
    expect(store.getDefinitionSpec('d1')!.domains).toEqual(['x.com'])
  })
  it('is a no-op (returns false) for an instance with no linked definition', () => {
    store.upsertInstanceMeta({ sbxName: 'orphan', definitionId: null, createdByApp: false, createdAt: 't' })
    expect(applyPortEdit(store, 'orphan', { hostPort: 1, containerPort: 1, protocol: 'tcp' }, 'add')).toBe(false)
    expect(applyDomainEdit(store, 'unknown-box', 'x.com', 'add')).toBe(false)
  })
})
