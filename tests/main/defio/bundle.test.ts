import { describe, it, expect } from 'vitest'
import { buildExportBundle, parseImportBundle, dedupeName, BundleError } from '../../../src/main/defio/bundle'
import type { DefinitionSpec } from '../../../src/shared/types'

const spec = (id: string, name: string): DefinitionSpec => ({
  definition: { id, name, description: 'd', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: ['api.example.com'],
  ports: [{ hostPort: 3000, containerPort: 8080, protocol: 'tcp', label: 'web' }],
  hostServices: [],
  credentials: [{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }],
  ssh: { forwardAgent: true, commitSigning: false }
})

describe('buildExportBundle', () => {
  const b = buildExportBundle([spec('d1', 'Alpha')], '2026-07-21T00:00:00.000Z')
  it('wraps specs with the envelope and strips id + createdAt', () => {
    expect(b.formatVersion).toBe('1')
    expect(b.kind).toBe('sandbox-definitions')
    expect(b.exportedAt).toBe('2026-07-21T00:00:00.000Z')
    expect((b.definitions[0].definition as Record<string, unknown>).id).toBeUndefined()
    expect((b.definitions[0].definition as Record<string, unknown>).createdAt).toBeUndefined()
    expect(b.definitions[0].definition.name).toBe('Alpha')
  })
  it('preserves the shareable spec fields (mounts, domains, ports, ssh, credential refs)', () => {
    const d = b.definitions[0]
    expect(d.mounts).toEqual([{ hostPath: '/p', mode: 'direct', isPrimary: true }])
    expect(d.domains).toEqual(['api.example.com'])
    expect(d.credentials).toEqual([{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }])
  })
  it('carries no secret values (only credential refs)', () => {
    expect(JSON.stringify(b)).not.toMatch(/sk-|ghp_|password|token"?\s*:\s*"[^"]/i)
  })
})

describe('parseImportBundle', () => {
  const good = JSON.stringify(buildExportBundle([spec('d1', 'Alpha'), spec('d2', 'Beta')], 'now'))
  it('parses a valid bundle', () => {
    const r = parseImportBundle(good)
    expect(r.definitions.map((d) => d.definition.name)).toEqual(['Alpha', 'Beta'])
    expect(r.skipped).toBe(0)
  })
  it('throws on bad JSON / wrong kind / wrong version / non-array', () => {
    expect(() => parseImportBundle('not json')).toThrow(BundleError)
    expect(() => parseImportBundle(JSON.stringify({ formatVersion: '1', kind: 'nope', definitions: [] }))).toThrow(BundleError)
    expect(() => parseImportBundle(JSON.stringify({ formatVersion: '99', kind: 'sandbox-definitions', definitions: [] }))).toThrow(BundleError)
    expect(() => parseImportBundle(JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', definitions: {} }))).toThrow(BundleError)
  })
  it('skips malformed entries but keeps valid ones', () => {
    const mixed = JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now', definitions: [
      buildExportBundle([spec('d1', 'Alpha')], 'now').definitions[0],
      { definition: { description: 'no name' } }
    ] })
    const r = parseImportBundle(mixed)
    expect(r.definitions.map((d) => d.definition.name)).toEqual(['Alpha'])
    expect(r.skipped).toBe(1)
  })
})

describe('kitCommandsYaml round-trip', () => {
  it('preserves kitCommandsYaml through export + import', () => {
    const withKit: DefinitionSpec = { ...spec('d1', 'Alpha'), kitCommandsYaml: 'commands:\n  install: echo hi\n' }
    const bundle = buildExportBundle([withKit], 'now')
    const { definitions } = parseImportBundle(JSON.stringify(bundle))
    expect(definitions[0].kitCommandsYaml).toBe('commands:\n  install: echo hi\n')
  })
  it('yields undefined (not a crash) when the entry has no kitCommandsYaml', () => {
    const bundle = buildExportBundle([spec('d1', 'Alpha')], 'now')
    const { definitions } = parseImportBundle(JSON.stringify(bundle))
    expect(definitions[0].kitCommandsYaml).toBeUndefined()
  })
})

describe('normalizeEntry agent backfill', () => {
  it('backfills agent from baseImage when importing an older bundle that predates the field', () => {
    const bundle = JSON.stringify({
      formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
      definitions: [{
        definition: { name: 'Old Export', description: '', baseImage: 'docker.io/docker/sandbox-templates:opencode', tier: 'locked' },
        mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
      }]
    })
    const { definitions } = parseImportBundle(bundle)
    expect(definitions[0].definition.agent).toBe('opencode')
  })
  it('preserves an explicit agent from a newer bundle', () => {
    const bundle = JSON.stringify({
      formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
      definitions: [{
        definition: { name: 'New Export', description: '', agent: 'codex', baseImage: 'my/custom:tag', tier: 'locked' },
        mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
      }]
    })
    const { definitions } = parseImportBundle(bundle)
    expect(definitions[0].definition.agent).toBe('codex')
  })
  it('rejects an unrecognized agent string and falls back to baseImage-derived agent', () => {
    const bundle = JSON.stringify({
      formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
      definitions: [{
        definition: { name: 'Tampered Export', description: '', agent: 'bogus', baseImage: 'docker.io/docker/sandbox-templates:opencode', tier: 'locked' },
        mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
      }]
    })
    const { definitions } = parseImportBundle(bundle)
    expect(definitions[0].definition.agent).toBe('opencode')
  })
  it('rejects a non-string agent value and falls back to baseImage-derived agent', () => {
    const bundle = JSON.stringify({
      formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
      definitions: [{
        definition: { name: 'Weird Export', description: '', agent: 42, baseImage: 'docker.io/docker/sandbox-templates:opencode', tier: 'locked' },
        mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
      }]
    })
    const { definitions } = parseImportBundle(bundle)
    expect(definitions[0].definition.agent).toBe('opencode')
  })
})

describe('dedupeName', () => {
  it('leaves a free name unchanged; suffixes on collision', () => {
    expect(dedupeName('Alpha', new Set())).toBe('Alpha')
    expect(dedupeName('Alpha', new Set(['Alpha']))).toBe('Alpha (imported)')
    expect(dedupeName('Alpha', new Set(['Alpha', 'Alpha (imported)']))).toBe('Alpha (imported 2)')
  })
})
