import { describe, it, expect } from 'vitest'
import type { McpMode, McpBinding, McpTransport, McpServer, McpServerDetail, McpAuthState, McpAddInput } from '@shared/mcp'

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
