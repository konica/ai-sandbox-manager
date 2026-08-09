import { describe, it, expect } from 'vitest'
import { AGENT_PROFILES, VARIANT_AGENT, agentFromBaseImage } from '@shared/agents'
import type { AgentId, BuiltinVariant } from '@shared/agents'

const AGENT_IDS: AgentId[] = ['claude', 'opencode', 'codex', 'copilot']
const VARIANTS: BuiltinVariant[] = ['claude-code', 'claude-code-docker', 'claude-code-minimal', 'opencode', 'codex', 'copilot']

describe('AGENT_PROFILES', () => {
  it('has a profile for every agent with a non-empty keyword and resumeArgs', () => {
    for (const id of AGENT_IDS) {
      const p = AGENT_PROFILES[id]
      expect(p.id).toBe(id)
      expect(p.keyword.length).toBeGreaterThan(0)
      expect(p.resumeArgs.length).toBeGreaterThan(0)
      expect(Array.isArray(p.domains)).toBe(true)
    }
  })
  it('carries the verified Claude values', () => {
    expect(AGENT_PROFILES.claude.keyword).toBe('claude')
    expect(AGENT_PROFILES.claude.resumeArgs).toEqual(['--continue'])
    expect(AGENT_PROFILES.claude.sessionNameArgs('Refactor auth')).toEqual(['--name', 'Refactor auth'])
    expect(AGENT_PROFILES.claude.domains).toContain('api.anthropic.com')
  })
  it('opencode ships with no hardcoded domains (multi-provider — user adds their own)', () => {
    expect(AGENT_PROFILES.opencode.domains).toEqual([])
  })
  it('has a boolean mcpSupported on every profile', () => {
    for (const id of AGENT_IDS) {
      expect(typeof AGENT_PROFILES[id].mcpSupported).toBe('boolean')
    }
  })
  it('locks the MCP-support matrix verified by the Phase 0 spike (#16)', () => {
    expect(AGENT_PROFILES.claude.mcpSupported).toBe(true)
    expect(AGENT_PROFILES.opencode.mcpSupported).toBe(true)
    expect(AGENT_PROFILES.codex.mcpSupported).toBe(true)
    expect(AGENT_PROFILES.copilot.mcpSupported).toBe(false)
  })
})

describe('VARIANT_AGENT', () => {
  it('maps every BuiltinVariant to an AgentId', () => {
    for (const v of VARIANTS) expect(AGENT_IDS).toContain(VARIANT_AGENT[v])
  })
  it('maps all three claude-code variants to claude', () => {
    expect(VARIANT_AGENT['claude-code']).toBe('claude')
    expect(VARIANT_AGENT['claude-code-docker']).toBe('claude')
    expect(VARIANT_AGENT['claude-code-minimal']).toBe('claude')
  })
})

describe('agentFromBaseImage', () => {
  it('matches a known variant suffix', () => {
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:opencode')).toBe('opencode')
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:codex')).toBe('codex')
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:copilot')).toBe('copilot')
  })
  it('does not let claude-code-docker/-minimal collide with the bare claude-code suffix check', () => {
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:claude-code-docker')).toBe('claude')
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:claude-code-minimal')).toBe('claude')
  })
  it('defaults to claude for an unrecognized or custom ref', () => {
    expect(agentFromBaseImage('my/custom:tag')).toBe('claude')
    expect(agentFromBaseImage('')).toBe('claude')
  })
})
