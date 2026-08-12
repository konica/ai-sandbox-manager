import { describe, it, expect } from 'vitest'
import {
  parseMcpLsJson,
  parseMcpLsText,
  parseMcpInspectJson,
  parseMcpInspectText,
  parseMcpAuthStatusJson,
  parseMcpAuthStatusText
} from '@main/sbx/mcp-parse'

describe('parseMcpLsText', () => {
  it('parses the documented table layout', () => {
    const out = [
      'NAME                 TYPE     URL/COMMAND',
      'notion               remote   https://mcp.notion.com/mcp',
      'github               local    npx @modelcontextprotocol/server-github'
    ].join('\n')
    expect(parseMcpLsText(out)).toEqual([
      { name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] },
      { name: 'github', transport: 'local', endpoint: 'npx @modelcontextprotocol/server-github', scopes: [] }
    ])
  })
  it('returns [] for an empty registry', () => {
    expect(parseMcpLsText('No MCP servers registered\n')).toEqual([])
    expect(parseMcpLsText('')).toEqual([])
  })
  it('returns [] for a header-only listing', () => {
    expect(parseMcpLsText('NAME  TYPE  URL/COMMAND\n')).toEqual([])
  })
})

describe('parseMcpLsJson', () => {
  it('parses a bare JSON array', () => {
    const json = JSON.stringify([{ name: 'notion', type: 'remote', url: 'https://mcp.notion.com/mcp' }])
    expect(parseMcpLsJson(json)).toEqual([
      { name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }
    ])
  })
  it('parses a { servers: [...] } envelope with scopes', () => {
    const json = JSON.stringify({ servers: [{ name: 'gh', type: 'command', command: 'gh mcp', scopes: ['proj-a'] }] })
    expect(parseMcpLsJson(json)).toEqual([
      { name: 'gh', transport: 'command', endpoint: 'gh mcp', scopes: ['proj-a'] }
    ])
  })
  it('returns [] for a shapeless object', () => {
    expect(parseMcpLsJson('{}')).toEqual([])
  })
  it('throws on non-JSON so the caller can fall back to text', () => {
    expect(() => parseMcpLsJson('NAME TYPE ...')).toThrow()
  })
})

describe('parseMcpInspectText', () => {
  it('parses the documented Key: value layout for a local server', () => {
    const out = [
      'Name:      github',
      'Type:      local',
      'Command:   npx @modelcontextprotocol/server-github',
      'Resolved:  /usr/local/bin/npx @modelcontextprotocol/server-github'
    ].join('\n')
    expect(parseMcpInspectText(out, 'github')).toEqual({
      name: 'github',
      transport: 'local',
      endpoint: 'npx @modelcontextprotocol/server-github',
      scopes: [],
      tools: undefined,
      raw: out
    })
  })
  it('never throws on unrecognized output; falls back to the provided name', () => {
    const out = 'not a key value line'
    expect(parseMcpInspectText(out, 'notion')).toEqual({
      name: 'notion',
      transport: 'command',
      endpoint: '',
      scopes: [],
      tools: undefined,
      raw: out
    })
  })
})

describe('parseMcpInspectJson', () => {
  it('parses a JSON object', () => {
    const json = JSON.stringify({ name: 'notion', type: 'remote', url: 'https://mcp.notion.com/mcp', scopes: ['proj-a'], tools: ['search'] })
    expect(parseMcpInspectJson(json, 'notion')).toEqual({
      name: 'notion',
      transport: 'remote',
      endpoint: 'https://mcp.notion.com/mcp',
      scopes: ['proj-a'],
      tools: ['search'],
      raw: json
    })
  })
  it('throws on non-JSON so the caller can fall back to text', () => {
    expect(() => parseMcpInspectJson('Name: github', 'github')).toThrow()
  })
})

describe('parseMcpAuthStatusJson', () => {
  it('parses a JSON array of per-server status objects', () => {
    const json = JSON.stringify([
      { name: 'notion', status: 'authorized' },
      { name: 'github', status: 'unauthorized' },
      { name: 'local-fs', status: 'not_required' }
    ])
    expect(parseMcpAuthStatusJson(json)).toEqual([
      { name: 'notion', state: 'authorized' },
      { name: 'github', state: 'unauthorized' },
      { name: 'local-fs', state: 'not-required' }
    ])
  })
  it('returns [] for an empty registry', () => {
    expect(parseMcpAuthStatusJson('[]')).toEqual([])
  })
  it('degrades malformed output to [] instead of throwing', () => {
    expect(parseMcpAuthStatusJson('not json')).toEqual([])
    expect(parseMcpAuthStatusJson('{}')).toEqual([])
  })
  it('maps unrecognized status strings to "unknown"', () => {
    const json = JSON.stringify([{ name: 'x', status: 'pending' }])
    expect(parseMcpAuthStatusJson(json)).toEqual([{ name: 'x', state: 'unknown' }])
  })
})

describe('parseMcpAuthStatusText', () => {
  it('parses a NAME/STATUS table', () => {
    const out = ['NAME     STATUS', 'notion   authorized', 'github   unauthorized'].join('\n')
    expect(parseMcpAuthStatusText(out)).toEqual([
      { name: 'notion', state: 'authorized' },
      { name: 'github', state: 'unauthorized' }
    ])
  })
  it('returns [] for empty output', () => {
    expect(parseMcpAuthStatusText('')).toEqual([])
  })
})
