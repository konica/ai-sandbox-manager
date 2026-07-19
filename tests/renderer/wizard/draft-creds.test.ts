import { describe, it, expect } from 'vitest'
import { draftReducer, initialDraft, toSpec, draftFromSpec } from '../../../src/renderer/wizard/draft'

const base = { ...initialDraft, workspace: '/p', name: 'p' }

describe('draft credentials', () => {
  it('adds a service credential and maps to a CredentialRef without the value', () => {
    const d = draftReducer(base, { type: 'addServiceCred', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', value: 'sk-ant' })
    expect(d.credentials).toHaveLength(1)
    const spec = toSpec(d, 'id1', '2026-07-19T00:00:00.000Z')
    expect(spec.credentials[0]).toEqual({ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' })
    expect(JSON.stringify(spec.credentials[0])).not.toContain('sk-ant')
  })
  it('adds a custom credential with headers', () => {
    const d = draftReducer(base, { type: 'addCustomCred', cred: { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], value: 'v' } })
    const spec = toSpec(d, 'id1', '2026-07-19T00:00:00.000Z')
    expect(spec.credentials[0]).toMatchObject({ kind: 'custom', id: 'acme', domains: ['api.acme.com'] })
  })
  it('removes a credential by index', () => {
    let d = draftReducer(base, { type: 'addServiceCred', serviceId: 'openai', envVar: 'OPENAI_API_KEY', value: 'x' })
    d = draftReducer(d, { type: 'removeCredential', index: 0 })
    expect(d.credentials).toHaveLength(0)
  })
  it('round-trips through draftFromSpec with empty values', () => {
    const d = draftReducer(base, { type: 'addServiceCred', serviceId: 'openai', envVar: 'OPENAI_API_KEY', value: 'x' })
    const spec = toSpec(d, 'id1', '2026-07-19T00:00:00.000Z')
    const d2 = draftFromSpec(spec)
    expect(d2.credentials[0]).toMatchObject({ kind: 'service', serviceId: 'openai', value: '' })
  })
})
