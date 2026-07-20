import { describe, it, expect } from 'vitest'
import type { CredentialRef, GlobalSecretMeta } from '../../src/shared/types'

describe('credential types', () => {
  it('accepts a service credential', () => {
    const c: CredentialRef = { kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }
    expect(c.kind).toBe('service')
  })
  it('accepts a custom credential (host + env var + domains)', () => {
    const c: CredentialRef = { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }
    expect(c.kind === 'custom' && c.domains[0]).toBe('api.acme.com')
  })
  it('accepts a registry credential (host + scope, optional username)', () => {
    const c: CredentialRef = { kind: 'registry', id: 'ghcr-io', host: 'ghcr.io', username: 'me', scope: 'global', store: 'sbx' }
    expect(c.kind === 'registry' && c.host).toBe('ghcr.io')
    expect(c.kind === 'registry' && c.scope).toBe('global')
  })
  it('accepts a token-only registry credential (no username)', () => {
    const c: CredentialRef = { kind: 'registry', id: 'my-azurecr-io', host: 'my.azurecr.io', scope: 'host', store: 'sbx' }
    expect(c.kind === 'registry' && c.username).toBeUndefined()
  })
  it('accepts a global secret meta', () => {
    const g: GlobalSecretMeta = { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: '2026-07-19T00:00:00.000Z' }
    expect(g.envVar).toBe('OPENAI_API_KEY')
  })
})
