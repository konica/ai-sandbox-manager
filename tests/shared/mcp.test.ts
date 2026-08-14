import { describe, it, expect } from 'vitest'
import type { McpMode, McpBinding, McpTransport, McpServer, McpServerDetail, McpAuthState, McpAddInput } from '@shared/mcp'
import { registryUrlForName, isRegistryServerName, POPULAR_MCP_SERVERS } from '@shared/mcp'

describe('McpBinding', () => {
  it('accepts every McpMode', () => {
    const modes: McpMode[] = ['off', 'dynamic', 'static']
    for (const mode of modes) {
      const b: McpBinding = { mode, servers: mode === 'static' ? ['github'] : [] }
      expect(b.mode).toBe(mode)
    }
  })
})

describe('McpServer / McpServerDetail', () => {
  it('accepts every McpTransport', () => {
    const transports: McpTransport[] = ['remote', 'local', 'command']
    for (const transport of transports) {
      const s: McpServer = { name: 'github', transport, endpoint: 'https://example.com', scopes: ['repo'] }
      expect(s.transport).toBe(transport)
    }
  })
  it('extends McpServer with optional tools and raw', () => {
    const d: McpServerDetail = { name: 'github', transport: 'remote', endpoint: 'https://example.com', scopes: [], raw: '{}' }
    expect(d.tools).toBeUndefined()
    const d2: McpServerDetail = { ...d, tools: ['search_issues'] }
    expect(d2.tools).toEqual(['search_issues'])
  })
})

describe('McpAuthState', () => {
  it('accepts every state', () => {
    const states: McpAuthState[] = ['authorized', 'unauthorized', 'not-required', 'unknown']
    expect(states).toHaveLength(4)
  })
})

describe('McpAddInput', () => {
  function describeInput(input: McpAddInput): string {
    switch (input.transport) {
      case 'remote':
        return `remote:${input.url}`
      case 'local':
        return `local:${input.metadataUrl}`
      case 'command':
        return `command:${input.command}:${input.args.join(',')}`
    }
  }

  it('narrows the remote variant (url, optional skipAuth)', () => {
    const input: McpAddInput = { transport: 'remote', name: 'github', url: 'https://mcp.example.com', scopes: ['repo'] }
    expect(describeInput(input)).toBe('remote:https://mcp.example.com')
    const withSkip: McpAddInput = { transport: 'remote', name: 'github', url: 'https://mcp.example.com', scopes: [], skipAuth: true }
    expect(withSkip.transport === 'remote' && withSkip.skipAuth).toBe(true)
  })

  it('narrows the local variant (metadataUrl)', () => {
    const input: McpAddInput = { transport: 'local', name: 'fs', metadataUrl: 'https://example.com/meta.json', scopes: [] }
    expect(describeInput(input)).toBe('local:https://example.com/meta.json')
  })

  it('narrows the command variant (command + args)', () => {
    const input: McpAddInput = { transport: 'command', name: 'local-tool', command: 'npx', args: ['-y', 'some-server'], scopes: [] }
    expect(describeInput(input)).toBe('command:npx:-y,some-server')
  })
})

describe('registryUrlForName', () => {
  // Verified against the live registry: this exact URL returns 200 and sbx registers it,
  // while the un-encoded form 404s. The slash in the namespaced name MUST be percent-encoded.
  it('builds the percent-encoded /versions/latest URL sbx resolves', () => {
    expect(registryUrlForName('io.github.github/github-mcp-server')).toBe(
      'https://registry.modelcontextprotocol.io/v0/servers/io.github.github%2Fgithub-mcp-server/versions/latest'
    )
  })
  it('encodes the separating slash rather than leaving a nested path', () => {
    expect(registryUrlForName('io.github.grafana/mcp-grafana')).not.toContain('grafana/mcp-grafana')
  })
  it('trims surrounding whitespace from a pasted name', () => {
    expect(registryUrlForName('  com.example/thing  ')).toBe(
      'https://registry.modelcontextprotocol.io/v0/servers/com.example%2Fthing/versions/latest'
    )
  })
})

describe('isRegistryServerName', () => {
  it('accepts a namespaced registry name', () => {
    expect(isRegistryServerName('io.github.github/github-mcp-server')).toBe(true)
  })
  it('rejects a bare name, a URL, and whitespace-bearing input', () => {
    expect(isRegistryServerName('github')).toBe(false)
    expect(isRegistryServerName('https://api.githubcopilot.com/mcp/')).toBe(false)
    expect(isRegistryServerName('io.github.github /x')).toBe(false)
    expect(isRegistryServerName('')).toBe(false)
  })
})

describe('POPULAR_MCP_SERVERS', () => {
  // Every entry was verified twice: its registry name resolves 200, and `sbx mcp add` with
  // the resulting URL actually registers. sbx rejects any manifest without an OCI package
  // ("no OCI package with a supported transport"), which excludes most of the registry --
  // so entries must not be added here without running that check.
  it('lists only vendor-verified namespaces', () => {
    expect(POPULAR_MCP_SERVERS.length).toBeGreaterThan(0)
    for (const s of POPULAR_MCP_SERVERS) {
      expect(isRegistryServerName(s.registryName)).toBe(true)
      expect(s.registryName).toMatch(/^(io\.github\.|com\.)/)
      expect(s.label.trim()).not.toBe('')
    }
  })
  it('includes GitHub, the case that motivated it', () => {
    const gh = POPULAR_MCP_SERVERS.find((s) => s.registryName === 'io.github.github/github-mcp-server')
    expect(gh?.label).toBe('GitHub')
  })
  it('has no duplicate registry names', () => {
    const names = POPULAR_MCP_SERVERS.map((s) => s.registryName)
    expect(new Set(names).size).toBe(names.length)
  })
})
