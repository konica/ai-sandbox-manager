import { describe, it, expect } from 'vitest'
import { buildKitSpec, buildLoginKit } from '../../../src/main/kit/generate'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(creds: DefinitionSpec['credentials'], tier: DefinitionSpec['definition']['tier'] = 'locked', domains: string[] = [], kitCommandsYaml?: string, agent: DefinitionSpec['definition']['agent'] = 'claude'): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'Proj Alpha', description: '', agent, baseImage: 'img:tag', tier, createdAt: '2026-07-19T00:00:00.000Z' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains, ports: [], hostServices: [], credentials: creds,
    ...(kitCommandsYaml !== undefined ? { kitCommandsYaml } : {})
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
  it('allowlists a registry host only when the credential is injected into the sandbox (global/sandbox), not host-only', () => {
    const k = buildKitSpec(spec([
      { kind: 'registry', id: 'ghcr', host: 'ghcr.io', username: 'me', scope: 'global', store: 'sbx' },
      { kind: 'registry', id: 'reg', host: 'reg.local', scope: 'sandbox', store: 'sbx' },
      { kind: 'registry', id: 'hub', host: 'private.hub', scope: 'host', store: 'sbx' }
    ]))
    expect(k.specYaml).toContain('ghcr.io')     // global → injected → reachable
    expect(k.specYaml).toContain('reg.local')   // sandbox → injected → reachable
    expect(k.specYaml).not.toContain('private.hub') // host-only → host pull, not in-VM
  })
  it('always allowlists the Claude agent baseline for a claude-agent definition (locked tier)', () => {
    const k = buildKitSpec(spec([], 'locked', [], undefined, 'claude'))
    for (const d of ['api.anthropic.com', 'platform.claude.com', 'console.anthropic.com', 'claude.com', 'downloads.claude.ai', 'claude.ai', 'mcp-proxy.anthropic.com']) {
      expect(k.specYaml).toContain(d)
    }
  })
  it('does not allowlist the Claude domains for an opencode-agent definition', () => {
    const k = buildKitSpec(spec([], 'locked', [], undefined, 'opencode'))
    expect(k.specYaml).not.toContain('api.anthropic.com')
  })
  it('allowlists the Codex domains for a codex-agent definition', () => {
    const k = buildKitSpec(spec([], 'locked', [], undefined, 'codex'))
    expect(k.specYaml).toContain('api.openai.com')
  })
  it('does not allowlist the Claude domains for a codex-agent definition', () => {
    const k = buildKitSpec(spec([], 'locked', [], undefined, 'codex'))
    expect(k.specYaml).not.toContain('api.anthropic.com')
  })
  it('does not allowlist the Codex/Copilot domains for a claude-agent definition', () => {
    const k = buildKitSpec(spec([], 'locked', [], undefined, 'claude'))
    expect(k.specYaml).not.toContain('api.openai.com')
    expect(k.specYaml).not.toContain('githubusercontent.com')
  })
  // Deliberate consequence of opencode being multi-provider (see src/shared/agents.ts):
  // its AGENT_PROFILES entry ships domains: [], so with no user domains/credentials/host
  // services the allowlist is empty and buildKitSpec's `if (domains.length)` guard omits
  // the `network:` block entirely. This branch was unreachable before per-agent domains
  // (Claude's baseline was spliced in unconditionally), so it needs its own pin. The user
  // is expected to add their configured provider's domain via the wizard's custom-domains
  // field — see Task 6's inline hint for agents with no built-in domains.
  it('emits no network block for an opencode-agent definition with no user domains/credentials/host services (locked tier) — deliberate multi-provider gap, not a fallback to Claude', () => {
    const k = buildKitSpec(spec([], 'locked', [], undefined, 'opencode'))
    expect(k.specYaml).not.toContain('network:')
    expect(k.specYaml).not.toContain('allowedDomains')
    expect(k.specYaml).not.toContain('api.anthropic.com') // would fail if a Claude fallback were ever added
  })
  it('allowlists localhost:<port> for each host service', () => {
    const s = spec([], 'locked', [])
    s.hostServices = [{ hostPort: 11434, label: 'Ollama' }]
    const k = buildKitSpec(s)
    expect(k.specYaml).toContain('localhost:11434')
  })
  it('buildLoginKit allowlists exactly the OAuth domains', () => {
    const k = buildLoginKit()
    for (const d of ['api.anthropic.com', 'platform.claude.com', 'console.anthropic.com', 'claude.com', 'downloads.claude.ai']) {
      expect(k.specYaml).toContain(d)
    }
    expect(k.secretFiles).toEqual([])
  })
  it('emits no secretFiles ever (kit carries no secrets)', () => {
    const k = buildKitSpec(spec([{ kind: 'service', serviceId: 'openai', envVar: 'OPENAI_API_KEY', store: 'sbx' }]))
    expect(k.secretFiles).toEqual([])
  })
  it('appends the commands block when the spec has kitCommandsYaml', () => {
    const s = spec([], 'locked', ['a.com'], 'commands:\n  install: echo hi\n')
    const y = buildKitSpec(s).specYaml
    expect(y).toContain('commands:')
    expect(y).toContain('echo hi')
    expect(y).toContain('allowedDomains') // app still owns network
  })
  it('omits commands when kitCommandsYaml is absent', () => {
    const s = spec([], 'locked', ['a.com'])
    expect(buildKitSpec(s).specYaml).not.toContain('commands:')
  })
})
