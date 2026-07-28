import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '../../../src/main/store/db'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(id: string, ssh?: DefinitionSpec['ssh']): DefinitionSpec {
  return {
    definition: { id, name: 'Proj', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: 't' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains: [], ports: [], hostServices: [], credentials: [], ssh
  }
}

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('ssh persistence', () => {
  it('persists and reloads ssh flags', () => {
    store.insertDefinitionSpec(spec('d1', { forwardAgent: false, commitSigning: false }))
    expect(store.getDefinitionSpec('d1')?.ssh).toEqual({ forwardAgent: false, commitSigning: false })
    store.insertDefinitionSpec(spec('d2', { forwardAgent: true, commitSigning: true }))
    expect(store.getDefinitionSpec('d2')?.ssh).toEqual({ forwardAgent: true, commitSigning: true })
  })
  it('defaults ssh (forward on, signing off) when not provided', () => {
    store.insertDefinitionSpec(spec('d3'))
    expect(store.getDefinitionSpec('d3')?.ssh).toEqual({ forwardAgent: true, commitSigning: false })
  })
  it('updateDefinitionSpec persists changed ssh flags', () => {
    store.insertDefinitionSpec(spec('d4', { forwardAgent: true, commitSigning: true }))
    store.updateDefinitionSpec(spec('d4', { forwardAgent: false, commitSigning: false }))
    expect(store.getDefinitionSpec('d4')?.ssh).toEqual({ forwardAgent: false, commitSigning: false })
  })
})
