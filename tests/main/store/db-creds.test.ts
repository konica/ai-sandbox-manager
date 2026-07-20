import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '../../../src/main/store/db'
import type { DefinitionSpec } from '../../../src/shared/types'

function baseSpec(id: string): DefinitionSpec {
  return {
    definition: { id, name: 'Proj', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains: [], ports: [],
    hostServices: [],
    credentials: [
      { kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' },
      { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }
    ]
  }
}

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('credential_ref round-trip', () => {
  it('persists and reloads service + custom credentials', () => {
    const spec = baseSpec('d1')
    store.insertDefinitionSpec(spec)
    const back = store.getDefinitionSpec('d1')
    expect(back?.credentials).toHaveLength(2)
    const svc = back!.credentials.find((c) => c.kind === 'service')
    expect(svc).toMatchObject({ serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' })
    const cust = back!.credentials.find((c) => c.kind === 'custom')
    expect(cust).toMatchObject({ id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' })
  })
  it('persists and reloads registry credentials (with and without username)', () => {
    const spec = baseSpec('d2')
    spec.credentials = [
      { kind: 'registry', id: 'ghcr-io', host: 'ghcr.io', username: 'me', scope: 'global', store: 'sbx' },
      { kind: 'registry', id: 'reg-local', host: 'reg.local', scope: 'host', store: 'sbx' }
    ]
    store.insertDefinitionSpec(spec)
    const back = store.getDefinitionSpec('d2')
    expect(back?.credentials).toHaveLength(2)
    expect(back!.credentials[0]).toEqual({ kind: 'registry', id: 'ghcr-io', host: 'ghcr.io', username: 'me', scope: 'global', store: 'sbx' })
    expect(back!.credentials[1]).toEqual({ kind: 'registry', id: 'reg-local', host: 'reg.local', username: undefined, scope: 'host', store: 'sbx' })
  })
})

describe('global_secret CRUD', () => {
  it('upserts, lists, and deletes', () => {
    store.upsertGlobalSecret({ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: '2026-07-19T00:00:00.000Z' })
    store.upsertGlobalSecret({ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: '2026-07-19T01:00:00.000Z' })
    expect(store.listGlobalSecrets()).toHaveLength(1)
    store.deleteGlobalSecret('openai')
    expect(store.listGlobalSecrets()).toHaveLength(0)
  })
})
