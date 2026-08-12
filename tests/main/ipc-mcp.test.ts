import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'
import { openStore } from '../../src/main/store/db'
import type { SbxAdapter } from '../../src/main/sbx/adapter'
import type { McpServer, McpServerDetail, McpAddInput } from '../../src/shared/mcp'

function deps(overrides: Partial<SbxAdapter> = {}, now?: () => number) {
  const adapter = {
    mcpSupported: vi.fn(async () => true),
    listMcpServers: vi.fn(async () => [{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }] as McpServer[]),
    inspectMcpServer: vi.fn(async (name: string) => ({ name, transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [], tools: ['search'], raw: 'raw' }) as McpServerDetail),
    addMcpServer: vi.fn(async () => {}),
    removeMcpServer: vi.fn(async () => {}),
    mcpAuthStatus: vi.fn(async () => 'authorized' as const),
    setMcpClientSecret: vi.fn(async () => {}),
    removeMcpAuth: vi.fn(async () => {}),
    ...overrides
  } as unknown as SbxAdapter
  const openTerminal = vi.fn()
  const h = buildHandlers({ adapter, store: openStore(':memory:'), probes: {} as never, openTerminal, now })
  return { h, adapter, openTerminal }
}

describe('mcp:supported', () => {
  it('returns the adapter capability probe wrapped in Result', async () => {
    const { h } = deps({ mcpSupported: vi.fn(async () => true) })
    const r = await h['mcp:supported']()
    expect(r).toEqual({ ok: true, data: true })
  })
  it('surfaces false without throwing when the adapter probe resolves false', async () => {
    const { h } = deps({ mcpSupported: vi.fn(async () => false) })
    const r = await h['mcp:supported']()
    expect(r).toEqual({ ok: true, data: false })
  })
})

describe('mcp:list', () => {
  it('returns the adapter list wrapped in Result', async () => {
    const { h } = deps()
    const r = await h['mcp:list']()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toEqual([{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }])
  })
  it('caches for a short window instead of re-invoking the adapter on every call', async () => {
    let t = 0
    const { h, adapter } = deps({}, () => t)
    await h['mcp:list']()
    t += 1000 // well within the ~5-10s window
    await h['mcp:list']()
    expect(adapter.listMcpServers).toHaveBeenCalledTimes(1)
  })
  it('re-fetches once the cache window has elapsed', async () => {
    let t = 0
    const { h, adapter } = deps({}, () => t)
    await h['mcp:list']()
    t += 20_000 // past the cache window
    await h['mcp:list']()
    expect(adapter.listMcpServers).toHaveBeenCalledTimes(2)
  })
  it('invalidates the cache after mcp:add and mcp:remove', async () => {
    let t = 0
    const { h, adapter } = deps({}, () => t)
    await h['mcp:list']()
    await h['mcp:add']({ transport: 'remote', name: 'notion', url: 'https://mcp.notion.com/mcp', scopes: [] })
    await h['mcp:list']()
    expect(adapter.listMcpServers).toHaveBeenCalledTimes(2)
  })
  it('surfaces adapter failures as a Result error rather than throwing', async () => {
    const { h } = deps({ listMcpServers: vi.fn(async () => { throw new Error('sbx mcp ls failed') }) })
    const r = await h['mcp:list']()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toContain('sbx mcp ls failed')
  })
})

describe('mcp:inspect', () => {
  it('returns detail for the named server', async () => {
    const { h, adapter } = deps()
    const r = await h['mcp:inspect']('notion')
    expect(adapter.inspectMcpServer).toHaveBeenCalledWith('notion')
    expect(r.ok && r.data.tools).toEqual(['search'])
  })
  it('surfaces a failed inspect as a Result error', async () => {
    const { h } = deps({ inspectMcpServer: vi.fn(async () => { throw new Error('not found') }) })
    const r = await h['mcp:inspect']('missing')
    expect(r).toEqual({ ok: false, error: { kind: 'generic', message: 'not found' } })
  })
})

describe('mcp:add / mcp:remove', () => {
  it('forwards the McpAddInput union to the adapter', async () => {
    const { h, adapter } = deps()
    const input: McpAddInput = { transport: 'command', name: 'gh', command: 'npx', args: ['@modelcontextprotocol/server-github'], scopes: [] }
    const r = await h['mcp:add'](input)
    expect(adapter.addMcpServer).toHaveBeenCalledWith(input)
    expect(r).toEqual({ ok: true, data: null })
  })
  it('removes by name', async () => {
    const { h, adapter } = deps()
    const r = await h['mcp:remove']('notion')
    expect(adapter.removeMcpServer).toHaveBeenCalledWith('notion')
    expect(r).toEqual({ ok: true, data: null })
  })
  it('surfaces an add failure as a Result error', async () => {
    const { h } = deps({ addMcpServer: vi.fn(async () => { throw new Error('already registered') }) })
    const r = await h['mcp:add']({ transport: 'remote', name: 'notion', url: 'https://mcp.notion.com/mcp', scopes: [] })
    expect(r).toEqual({ ok: false, error: { kind: 'generic', message: 'already registered' } })
  })
})

describe('mcp:authStatus', () => {
  it('returns the adapter auth state', async () => {
    const { h } = deps()
    const r = await h['mcp:authStatus']('notion')
    expect(r).toEqual({ ok: true, data: 'authorized' })
  })
})

describe('mcp:startAuth', () => {
  it('opens a terminal running `sbx mcp auth <server>` and returns immediately', async () => {
    const { h, openTerminal } = deps()
    const r = await h['mcp:startAuth']('notion')
    expect(r).toEqual({ ok: true, data: null })
    expect(openTerminal).toHaveBeenCalledTimes(1)
    expect(openTerminal.mock.calls[0][0]).toContain('sbx mcp auth notion')
  })
})

describe('mcp:setClientSecret', () => {
  it('forwards the value to the adapter and returns no secret material', async () => {
    const { h, adapter } = deps()
    const r = await h['mcp:setClientSecret']('notion', 's3cr3t')
    expect(adapter.setMcpClientSecret).toHaveBeenCalledWith('notion', 's3cr3t')
    expect(r).toEqual({ ok: true, data: null })
    expect(JSON.stringify(r)).not.toContain('s3cr3t')
  })
})

describe('mcp:removeAuth', () => {
  it('clears the stored client secret', async () => {
    const { h, adapter } = deps()
    const r = await h['mcp:removeAuth']('notion')
    expect(adapter.removeMcpAuth).toHaveBeenCalledWith('notion')
    expect(r).toEqual({ ok: true, data: null })
  })
})
