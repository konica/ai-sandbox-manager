import { describe, it, expect } from 'vitest'
import { buildKitSpec } from '../../../src/main/kit/generate'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(creds: DefinitionSpec['credentials'], tier: DefinitionSpec['definition']['tier'] = 'locked', domains: string[] = []): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'Proj Alpha', description: '', baseImage: 'img:tag', tier, createdAt: '2026-07-19T00:00:00.000Z' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains, ports: [], hostServices: [], credentials: creds
  }
}

describe('buildKitSpec', () => {
  it('emits a mixin kit with schemaVersion 1', () => {
    const k = buildKitSpec(spec([]))
    expect(k.specYaml).toContain('schemaVersion: "1"')
    expect(k.specYaml).toContain('kind: mixin')
  })
  it('is allowlist-only — no serviceAuth/credentials/proxyManaged and no secret files (injection is via set-custom)', () => {
    const k = buildKitSpec(spec([{ kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }]))
    expect(k.specYaml).not.toContain('serviceAuth')
    expect(k.specYaml).not.toContain('serviceDomains')
    expect(k.specYaml).not.toContain('proxyManaged')
    expect(k.specYaml).not.toContain('hostServices: [], credentials:')
    expect(k.specYaml).toContain('api.acme.com') // custom host still allowlisted for reachability
    expect(k.secretFiles).toEqual([])
  })
  it('adds service + custom + tier domains to allowedDomains, deduped', () => {
    const k = buildKitSpec(spec(
      [{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' },
       { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }],
      'balanced', ['example.com']))
    expect(k.specYaml).toContain('api.anthropic.com')
    expect(k.specYaml).toContain('api.acme.com')
    expect(k.specYaml).toContain('example.com')
    const anthropicCount = (k.specYaml.match(/api\.anthropic\.com/g) || []).length
    expect(anthropicCount).toBe(1)
  })
  it('emits no secretFiles ever (kit carries no secrets)', () => {
    const k = buildKitSpec(spec([{ kind: 'service', serviceId: 'openai', envVar: 'OPENAI_API_KEY', store: 'sbx' }]))
    expect(k.secretFiles).toEqual([])
  })
})
