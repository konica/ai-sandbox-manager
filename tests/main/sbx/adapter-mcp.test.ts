import { describe, it, expect, vi } from 'vitest'
import { createSbxAdapter, type SpawnFn } from '@main/sbx/adapter'
import type { McpAddInput } from '@shared/mcp'

function fakeSpawn(result: { stdout?: string; stderr?: string; code?: number } = {}) {
  const calls: { args: string[]; stdin?: string }[] = []
  const spawn: SpawnFn = (_cmd, args, opts) => {
    calls.push({ args, stdin: opts?.stdin })
    return Promise.resolve({ stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.code ?? 0 })
  }
  return { spawn, calls }
}

/** Mimics a real sbx that rejects `--json` outright (exit 1, "unknown flag") and only speaks text. */
function unknownFlagSpawn(textStdout: string) {
  const calls: { args: string[]; stdin?: string }[] = []
  const spawn: SpawnFn = (_cmd, args, opts) => {
    calls.push({ args, stdin: opts?.stdin })
    if (args.includes('--json')) {
      return Promise.resolve({ stdout: '', stderr: 'ERROR: unknown flag: --json\n', code: 1 })
    }
    return Promise.resolve({ stdout: textStdout, stderr: '', code: 0 })
  }
  return { spawn, calls }
}

describe('adapter.addMcpServer', () => {
  it('builds argv for a remote server (--url, repeated --scope, --skip_auth)', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    const input: McpAddInput = { transport: 'remote', name: 'notion', url: 'https://mcp.notion.com/mcp', scopes: ['proj-a', 'proj-b'], skipAuth: true }
    await a.addMcpServer(input)
    expect(calls[0].args).toEqual([
      'mcp', 'add', 'notion', '--url', 'https://mcp.notion.com/mcp', '--scope', 'proj-a', '--scope', 'proj-b', '--skip_auth'
    ])
  })
  it('omits --skip_auth for a remote server when not requested', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    const input: McpAddInput = { transport: 'remote', name: 'notion', url: 'https://mcp.notion.com/mcp', scopes: [] }
    await a.addMcpServer(input)
    expect(calls[0].args).toEqual(['mcp', 'add', 'notion', '--url', 'https://mcp.notion.com/mcp'])
  })
  it('builds argv for a local server (--local --url)', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    const input: McpAddInput = { transport: 'local', name: 'github', metadataUrl: 'https://example.com/metadata.json', scopes: ['proj-a'] }
    await a.addMcpServer(input)
    expect(calls[0].args).toEqual(['mcp', 'add', 'github', '--local', '--url', 'https://example.com/metadata.json', '--scope', 'proj-a'])
  })
  it('builds argv for a command server (--command, repeated --args)', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    const input: McpAddInput = { transport: 'command', name: 'gh', command: 'npx', args: ['@modelcontextprotocol/server-github'], scopes: [] }
    await a.addMcpServer(input)
    expect(calls[0].args).toEqual(['mcp', 'add', 'gh', '--command', 'npx', '--args', '@modelcontextprotocol/server-github'])
  })
})

describe('adapter.removeMcpServer', () => {
  it('runs `sbx mcp rm <name>`', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.removeMcpServer('notion')
    expect(calls[0].args).toEqual(['mcp', 'rm', 'notion'])
  })
})

describe('adapter.setMcpClientSecret / removeMcpAuth', () => {
  it('delegates to the global stdin secret path, never putting the value on argv', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.setMcpClientSecret('notion', 's3cr3t')
    expect(calls[0].args).toEqual(['secret', 'set', '-g', 'mcp:notion.client_secret'])
    expect(calls[0].stdin).toBe('s3cr3t')
    expect(calls[0].args.join(' ')).not.toContain('s3cr3t')
  })
  it('removes the client secret via the global secret path', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.removeMcpAuth('notion')
    expect(calls[0].args).toEqual(['secret', 'rm', '-g', 'mcp:notion.client_secret', '-f'])
  })
})

describe('adapter.loadMcpServer', () => {
  it('runs `sbx mcp load <server> --sandbox <name>`', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter(spawn)
    await a.loadMcpServer('my-box', 'notion')
    expect(calls[0].args).toEqual(['mcp', 'load', 'notion', '--sandbox', 'my-box'])
  })
})

describe('adapter.listMcpServers', () => {
  it('prefers --json and parses it', async () => {
    const json = JSON.stringify([{ name: 'notion', type: 'remote', url: 'https://mcp.notion.com/mcp' }])
    const { spawn, calls } = fakeSpawn({ stdout: json })
    const a = createSbxAdapter(spawn)
    const rows = await a.listMcpServers()
    expect(calls[0].args).toEqual(['mcp', 'ls', '--json'])
    expect(rows).toEqual([{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }])
  })
  it('falls back to text parsing when --json is not valid JSON', async () => {
    const text = 'NAME    TYPE    URL/COMMAND\nnotion  remote  https://mcp.notion.com/mcp'
    const { spawn } = fakeSpawn({ stdout: text })
    const a = createSbxAdapter(spawn)
    const rows = await a.listMcpServers()
    expect(rows).toEqual([{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }])
  })
  it('retries without --json when sbx rejects the flag, instead of surfacing "unknown flag"', async () => {
    const text = 'NAME    TYPE    URL/COMMAND\nnotion  remote  https://mcp.notion.com/mcp'
    const { spawn, calls } = unknownFlagSpawn(text)
    const a = createSbxAdapter(spawn)
    const rows = await a.listMcpServers()
    expect(calls.map((c) => c.args)).toEqual([['mcp', 'ls', '--json'], ['mcp', 'ls']])
    expect(rows).toEqual([{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }])
  })
  it('reports an empty registry rather than an error on a flagless sbx with no servers', async () => {
    const { spawn } = unknownFlagSpawn('No MCP servers registered\n')
    const a = createSbxAdapter(spawn)
    await expect(a.listMcpServers()).resolves.toEqual([])
  })
  it('surfaces a genuine failure when the flagless retry also fails', async () => {
    const spawn: SpawnFn = () => Promise.resolve({ stdout: '', stderr: 'ERROR: docker daemon unreachable', code: 1 })
    const a = createSbxAdapter(spawn)
    await expect(a.listMcpServers()).rejects.toThrow(/docker daemon unreachable/)
  })
})

describe('adapter.inspectMcpServer', () => {
  it('falls back to text parsing for the documented Key: value layout', async () => {
    const text = 'Name:      github\nType:      local\nCommand:   npx @modelcontextprotocol/server-github'
    const { spawn, calls } = fakeSpawn({ stdout: text })
    const a = createSbxAdapter(spawn)
    const detail = await a.inspectMcpServer('github')
    expect(calls[0].args).toEqual(['mcp', 'inspect', 'github', '--json'])
    expect(detail).toMatchObject({ name: 'github', transport: 'local', endpoint: 'npx @modelcontextprotocol/server-github' })
  })
  it('retries without --json when sbx rejects the flag', async () => {
    const text = 'Name:      github\nType:      local\nCommand:   npx @modelcontextprotocol/server-github'
    const { spawn, calls } = unknownFlagSpawn(text)
    const a = createSbxAdapter(spawn)
    const detail = await a.inspectMcpServer('github')
    expect(calls.map((c) => c.args)).toEqual([
      ['mcp', 'inspect', 'github', '--json'],
      ['mcp', 'inspect', 'github']
    ])
    expect(detail).toMatchObject({ name: 'github', transport: 'local', endpoint: 'npx @modelcontextprotocol/server-github' })
  })
})

describe('adapter.mcpAuthStatus', () => {
  it('reads the named entry out of the JSON array', async () => {
    const json = JSON.stringify([{ name: 'notion', status: 'authorized' }])
    const { spawn, calls } = fakeSpawn({ stdout: json })
    const a = createSbxAdapter(spawn)
    const state = await a.mcpAuthStatus('notion')
    expect(calls[0].args).toEqual(['mcp', 'auth', 'status', 'notion', '--format', 'json'])
    expect(state).toBe('authorized')
  })
  it('resolves "unknown" when the server is absent from malformed output', async () => {
    const { spawn } = fakeSpawn({ stdout: 'not json' })
    const a = createSbxAdapter(spawn)
    expect(await a.mcpAuthStatus('notion')).toBe('unknown')
  })
})

describe('adapter.mcpSupported', () => {
  it('returns true when the help output lists an mcp command', async () => {
    const help = 'Available Commands:\n  create\n  ls\n  mcp\n  ports\n'
    const { spawn } = fakeSpawn({ stdout: help })
    const a = createSbxAdapter(spawn)
    expect(await a.mcpSupported()).toBe(true)
  })
  it('returns false (never throws) when the CLI lacks mcp subcommands', async () => {
    const help = 'Available Commands:\n  create\n  ls\n  ports\n'
    const { spawn } = fakeSpawn({ stdout: help })
    const a = createSbxAdapter(spawn)
    expect(await a.mcpSupported()).toBe(false)
  })
  it('returns false when the spawn itself fails', async () => {
    const spawn: SpawnFn = vi.fn().mockRejectedValue(new Error('sbx not found'))
    const a = createSbxAdapter(spawn)
    await expect(a.mcpSupported()).resolves.toBe(false)
  })
})
