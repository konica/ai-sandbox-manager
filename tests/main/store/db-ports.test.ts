import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '../../../src/main/store/db'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(id: string): DefinitionSpec {
  return {
    definition: { id, name: 'P', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains: [],
    ports: [
      { hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: 'web' },
      { hostPort: null, containerPort: 9229, protocol: 'tcp6', label: '' }
    ],
    hostServices: [{ hostPort: 11434, label: 'Ollama' }],
    credentials: []
  }
}

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('ports + host services round-trip', () => {
  it('persists and reloads explicit + ephemeral ports with protocol', () => {
    store.insertDefinitionSpec(spec('d1'))
    const back = store.getDefinitionSpec('d1')!
    expect(back.ports).toEqual([
      { hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: 'web' },
      { hostPort: null, containerPort: 9229, protocol: 'tcp6', label: '' }
    ])
    expect(back.hostServices).toEqual([{ hostPort: 11434, label: 'Ollama' }])
  })
})
