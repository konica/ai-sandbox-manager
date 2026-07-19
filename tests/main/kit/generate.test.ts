import { describe, it, expect } from 'vitest'
import { buildKitSpec } from '../../../src/main/kit/generate'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(creds: DefinitionSpec['credentials'], tier: DefinitionSpec['definition']['tier'] = 'locked', domains: string[] = []): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'Proj Alpha', description: '', baseImage: 'img:tag', tier, createdAt: '2026-07-19T00:00:00.000Z' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains, ports: [], credentials: creds
  }
}

describe('buildKitSpec', () => {
  it('emits a mixin kit with schemaVersion 1', () => {
    const k = buildKitSpec(spec([]))
    expect(k.specYaml).toContain('schemaVersion: "1"')
    expect(k.specYaml).toContain('kind: mixin')
  })
  it('includes the custom four-block for a custom credential', () => {
    const k = buildKitSpec(spec([{ kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'Authorization', format: 'Bearer %s' }], store: 'encrypted' }]))
    expect(k.specYaml).toContain('serviceDomains:')
    expect(k.specYaml).toContain('api.acme.com: acme')
    expect(k.specYaml).toContain('headerName: "Authorization"')
    expect(k.specYaml).toContain('valueFormat: "Bearer %s"')
    expect(k.specYaml).toContain('proxyManaged:')
    expect(k.specYaml).toContain('ACME_KEY')
    expect(k.secretFiles).toEqual([{ relPath: 'secrets/acme', envVar: 'ACME_KEY', credId: 'acme' }])
  })
  it('adds service + custom + tier domains to allowedDomains, deduped', () => {
    const k = buildKitSpec(spec(
      [{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' },
       { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'X-Key', format: '%s' }], store: 'encrypted' }],
      'balanced', ['example.com']))
    expect(k.specYaml).toContain('api.anthropic.com')
    expect(k.specYaml).toContain('api.acme.com')
    expect(k.specYaml).toContain('example.com')
    const anthropicCount = (k.specYaml.match(/api\.anthropic\.com/g) || []).length
    expect(anthropicCount).toBe(1)
  })
  it('emits no secretFiles when there are no custom credentials', () => {
    const k = buildKitSpec(spec([{ kind: 'service', serviceId: 'openai', envVar: 'OPENAI_API_KEY', store: 'sbx' }]))
    expect(k.secretFiles).toEqual([])
  })
})
