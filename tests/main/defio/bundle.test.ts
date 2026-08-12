import { describe, it, expect } from 'vitest'
import { buildExportBundle, parseImportBundle, dedupeName, BundleError } from '../../../src/main/defio/bundle'
import type { DefinitionSpec } from '../../../src/shared/types'
import type { AgentId } from '../../../src/shared/agents'

const spec = (id: string, name: string, agent: AgentId = 'claude'): DefinitionSpec => ({
  definition: { id, name, description: 'd', agent, baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
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

describe('non-claude agent full round trip', () => {
  it('survives buildExportBundle -> JSON.stringify -> parseImportBundle for a non-claude agent', () => {
    const bundle = buildExportBundle([spec('d1', 'Codex Box', 'codex')], '2026-07-28T00:00:00.000Z')
    const wire = JSON.stringify(bundle)
    const { definitions } = parseImportBundle(wire)
    expect(definitions).toHaveLength(1)
    expect(definitions[0].definition.agent).toBe('codex')
    expect(definitions[0].definition.name).toBe('Codex Box')
  })
})

describe('cpus/memory round-trip on import', () => {
  it('carries valid cpus and memory through export + import', () => {
    const withLimits: DefinitionSpec = { ...spec('d1', 'Alpha'), definition: { ...spec('d1', 'Alpha').definition, cpus: 4, memory: '8g' } }
    const bundle = buildExportBundle([withLimits], 'now')
    const { definitions } = parseImportBundle(JSON.stringify(bundle))
    expect(definitions[0].definition.cpus).toBe(4)
    expect(definitions[0].definition.memory).toBe('8g')
  })
  it('drops invalid cpus (non-integer) and invalid memory (bad unit) to undefined', () => {
    const bundle = JSON.stringify({
      formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
      definitions: [{
        definition: { name: 'Tampered', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', cpus: 2.5, memory: 'lots' },
        mounts: [], domains: [], ports: [], hostServices: [], credentials: []
      }]
    })
    const { definitions } = parseImportBundle(bundle)
    expect(definitions[0].definition.cpus).toBeUndefined()
    expect(definitions[0].definition.memory).toBeUndefined()
  })
  it('yields undefined (not a crash) when cpus/memory are absent', () => {
    const bundle = buildExportBundle([spec('d1', 'Alpha')], 'now')
    const { definitions } = parseImportBundle(JSON.stringify(bundle))
    expect(definitions[0].definition.cpus).toBeUndefined()
    expect(definitions[0].definition.memory).toBeUndefined()
  })
})

describe('mcp round-trip on import', () => {
  it('preserves mode + servers through export + import', () => {
    const withMcp: DefinitionSpec = { ...spec('d1', 'Alpha'), mcp: { mode: 'static', servers: ['s1', 's2'] } }
    const bundle = buildExportBundle([withMcp], 'now')
    const { definitions } = parseImportBundle(JSON.stringify(bundle))
    expect(definitions[0].mcp).toEqual({ mode: 'static', servers: ['s1', 's2'] })
  })
  it('preserves dynamic mode with an empty servers list', () => {
    const withMcp: DefinitionSpec = { ...spec('d1', 'Alpha'), mcp: { mode: 'dynamic', servers: [] } }
    const bundle = buildExportBundle([withMcp], 'now')
    const { definitions } = parseImportBundle(JSON.stringify(bundle))
    expect(definitions[0].mcp).toEqual({ mode: 'dynamic', servers: [] })
  })
  it('yields undefined (not a crash) when mcp is absent', () => {
    const bundle = buildExportBundle([spec('d1', 'Alpha')], 'now')
    const { definitions } = parseImportBundle(JSON.stringify(bundle))
    expect(definitions[0].mcp).toBeUndefined()
  })
  it('degrades malformed mode to off without throwing', () => {
    const bundle = JSON.stringify({
      formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
      definitions: [{
        definition: { name: 'Tampered', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked' },
        mounts: [], domains: [], ports: [], hostServices: [], credentials: [],
        mcp: { mode: 'bogus', servers: ['s1'] }
      }]
    })
    const { definitions } = parseImportBundle(bundle)
    expect(definitions[0].mcp).toEqual({ mode: 'off', servers: ['s1'] })
  })
  it('filters non-string entries out of servers', () => {
    const bundle = JSON.stringify({
      formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
      definitions: [{
        definition: { name: 'Tampered', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked' },
        mounts: [], domains: [], ports: [], hostServices: [], credentials: [],
        mcp: { mode: 'static', servers: ['s1', 42, null, 's2'] }
      }]
    })
    const { definitions } = parseImportBundle(bundle)
    expect(definitions[0].mcp).toEqual({ mode: 'static', servers: ['s1', 's2'] })
  })
  it('degrades a non-object mcp to undefined without throwing', () => {
    const bundle = JSON.stringify({
      formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
      definitions: [{
        definition: { name: 'Tampered', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked' },
        mounts: [], domains: [], ports: [], hostServices: [], credentials: [],
        mcp: 'nope'
      }]
    })
    const { definitions } = parseImportBundle(bundle)
    expect(definitions[0].mcp).toBeUndefined()
  })
})

describe('copyFiles round-trip on import (regression)', () => {
  it('preserves copyFiles through export + import', () => {
    const withCopyFiles: DefinitionSpec = { ...spec('d1', 'Alpha'), copyFiles: [{ hostPath: '/host/f', sandboxPath: '/sbx/f' }] }
    const bundle = buildExportBundle([withCopyFiles], 'now')
    const { definitions } = parseImportBundle(JSON.stringify(bundle))
    expect(definitions[0].copyFiles).toEqual([{ hostPath: '/host/f', sandboxPath: '/sbx/f' }])
  })
  it('yields [] (not a crash) when copyFiles is absent', () => {
    const bundle = buildExportBundle([spec('d1', 'Alpha')], 'now')
    const { definitions } = parseImportBundle(JSON.stringify(bundle))
    expect(definitions[0].copyFiles).toEqual([])
  })
})

describe('dedupeName', () => {
  it('leaves a free name unchanged; suffixes on collision', () => {
    expect(dedupeName('Alpha', new Set())).toBe('Alpha')
    expect(dedupeName('Alpha', new Set(['Alpha']))).toBe('Alpha (imported)')
    expect(dedupeName('Alpha', new Set(['Alpha', 'Alpha (imported)']))).toBe('Alpha (imported 2)')
  })
})
