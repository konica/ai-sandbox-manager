import { describe, it, expect } from 'vitest'
import { staticMcpArgs, launchCommand } from '../../../src/main/sbx/translate'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(over: Partial<DefinitionSpec> = {}): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
    mounts: [{ hostPath: '/home/u/proj', mode: 'direct', isPrimary: true }],
    domains: [],
    ports: [],
    hostServices: [],
    credentials: [],
    ...over
  }
}

describe('staticMcpArgs', () => {
  it('returns [] for an empty server list (no flag)', () => {
    expect(staticMcpArgs([])).toEqual([])
  })
  it('joins server names into a single comma-separated --static-mcp flag', () => {
    expect(staticMcpArgs(['notion'])).toEqual(['--static-mcp', 'notion'])
    expect(staticMcpArgs(['notion', 'github'])).toEqual(['--static-mcp', 'notion,github'])
  })
})

describe('launchCommand — MCP binding', () => {
  it('a static definition launches with --static-mcp before the -- separator', () => {
    const cmd = launchCommand(spec(), 'my-project', 'Refactor auth', undefined, [], ['notion', 'github'])
    expect(cmd).toMatch(/&& sbx run --name my-project --static-mcp 'notion,github' -- --name 'Refactor auth'$/)
  })
  it('a static definition with no session name still gets the flag, with nothing after it', () => {
    const cmd = launchCommand(spec(), 'my-project', undefined, undefined, [], ['notion'])
    // "notion" alone needs no quoting (no comma), unlike the multi-name case above.
    expect(cmd).toMatch(/&& sbx run --name my-project --static-mcp notion$/)
  })
  it('dynamic/off (no resolved servers) launches with no MCP flag at all', () => {
    const cmd = launchCommand(spec(), 'my-project')
    expect(cmd).toMatch(/&& sbx run --name my-project$/)
    expect(cmd).not.toContain('--static-mcp')
  })
})
