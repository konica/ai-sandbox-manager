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
  it('normalizes a live-traffic host:port to a bare domain when adding', () => {
    // Live Traffic hosts come from `sbx policy log` with a port (e.g. api.anthropic.com:443);
    // the definition stores bare hostnames (matching the wizard + kit).
    applyDomainEdit(store, 'box', 'api.anthropic.com:443', 'add')
    expect(store.getDefinitionSpec('d1')!.domains).toEqual(['api.anthropic.com'])
  })
  it('removes a bare definition domain even when denied as host:port', () => {
    applyDomainEdit(store, 'box', 'api.anthropic.com', 'add')
    applyDomainEdit(store, 'box', 'api.anthropic.com:443', 'remove')
    expect(store.getDefinitionSpec('d1')!.domains).toEqual([])
  })
  it('removes a legacy port-suffixed domain (stored with :443) when denied', () => {
    // Domains added before normalization can be stored as "host:443"; the ✕ passes that
    // exact value. Remove must match by bare host on both sides.
    const s = store.getDefinitionSpec('d1')!
    s.domains = ['mgm-atlassian.mgm-tp.com:443', 'other.com']
    store.updateDefinitionSpec(s)
    applyDomainEdit(store, 'box', 'mgm-atlassian.mgm-tp.com:443', 'remove')
    expect(store.getDefinitionSpec('d1')!.domains).toEqual(['other.com'])
  })
  it('does not add a duplicate when a port-suffixed variant is already stored', () => {
    const s = store.getDefinitionSpec('d1')!
    s.domains = ['dup.com:443']
    store.updateDefinitionSpec(s)
    applyDomainEdit(store, 'box', 'dup.com', 'add')
    expect(store.getDefinitionSpec('d1')!.domains).toEqual(['dup.com:443'])
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
