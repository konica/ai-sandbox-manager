import { describe, it, expect } from 'vitest'
import type { CredentialRef, GlobalSecretMeta } from '../../src/shared/types'

describe('credential types', () => {
  it('accepts a service credential', () => {
    const c: CredentialRef = { kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }
    expect(c.kind).toBe('service')
  })
  it('accepts a custom credential with headers', () => {
    const c: CredentialRef = { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'Authorization', format: 'Bearer %s' }], store: 'encrypted' }
    expect(c.kind === 'custom' && c.headers[0].format).toBe('Bearer %s')
  })
  it('accepts a global secret meta', () => {
    const g: GlobalSecretMeta = { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: '2026-07-19T00:00:00.000Z' }
    expect(g.envVar).toBe('OPENAI_API_KEY')
  })
})
