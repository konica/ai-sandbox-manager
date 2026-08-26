import { describe, it, expect, vi } from 'vitest'
import { launchDefinition, resolveMcpServers } from '../../src/main/launch'
import type { DefinitionSpec, InstanceMeta, SbxInstance } from '../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [],
  ports: [],
  hostServices: [], credentials: []
}

describe('resolveMcpServers', () => {
  function fakeAdapter(liveNames: string[]) {
    const live = liveNames.map((name) => ({ name, transport: 'command' as const, endpoint: '', scopes: [] }))
    return { listMcpServers: vi.fn(async () => live) }
  }

  it('returns [] for an off/absent binding without calling the adapter', async () => {
    const adapter = fakeAdapter(['notion'])
    const out = await resolveMcpServers(adapter, spec)
    expect(out).toEqual([])
    expect(adapter.listMcpServers).not.toHaveBeenCalled()
  })

  it('returns [] for a dynamic binding without calling the adapter', async () => {
    const adapter = fakeAdapter(['notion'])
    const out = await resolveMcpServers(adapter, { ...spec, mcp: { mode: 'dynamic', servers: [] } })
    expect(out).toEqual([])
    expect(adapter.listMcpServers).not.toHaveBeenCalled()
  })

  it('keeps a static server that is still registered', async () => {
    const adapter = fakeAdapter(['notion', 'github'])
    const out = await resolveMcpServers(adapter, { ...spec, mcp: { mode: 'static', servers: ['notion'] } })
    expect(out).toEqual(['notion'])
  })

  it('drops an unknown static server and logs a warning, keeping the rest', async () => {
    const adapter = fakeAdapter(['github'])
    const errors: string[] = []
    const log = { info: () => {}, command: () => {}, error: (m: string) => errors.push(m) }
    const out = await resolveMcpServers(adapter, { ...spec, mcp: { mode: 'static', servers: ['notion', 'github'] } }, log)
    expect(out).toEqual(['github'])
    expect(errors.some((m) => /notion/.test(m) && /no longer registered|skip/i.test(m))).toBe(true)
  })

  it('drops all requested servers (without throwing) when listing the live registry fails', async () => {
    const adapter = { listMcpServers: vi.fn(async () => { throw new Error('sbx mcp unsupported') }) }
    const errors: string[] = []
    const log = { info: () => {}, command: () => {}, error: (m: string) => errors.push(m) }
    const out = await resolveMcpServers(adapter, { ...spec, mcp: { mode: 'static', servers: ['notion'] } }, log)
    expect(out).toEqual([])
    expect(errors.length).toBeGreaterThan(0)
  })
})

function deps(getSpec: () => DefinitionSpec | undefined, liveMcpNames: string[] = []) {
  const metas: InstanceMeta[] = []
  const store = {
    getDefinitionSpec: vi.fn(getSpec),
    upsertInstanceMeta: vi.fn((m: InstanceMeta) => { metas.push(m) }),
    listInstanceMeta: vi.fn(() => metas),
    setInstanceTags: vi.fn()
  } as never
  const liveMcp = liveMcpNames.map((name) => ({ name, transport: 'command' as const, endpoint: '', scopes: [] }))
  const adapter = {
    listSandboxes: vi.fn(async (): Promise<SbxInstance[]> => []),
    setSecret: vi.fn(async () => {}),
    setCustomSecret: vi.fn(async () => {}),
    setRegistrySecret: vi.fn(async () => {}),
    checkDockerAuth: vi.fn(async (): Promise<'pass' | 'fail' | 'unknown'> => 'pass'),
    listMcpServers: vi.fn(async () => liveMcp)
  }
  const creds = { getStaged: () => null }
  const materializeKit = vi.fn(() => undefined)
  const openTerminal = vi.fn()
  const infos: string[] = []
  const log = { info: (m: string) => infos.push(m), command: () => {}, error: (m: string) => infos.push(m) }
  return { adapter, store, creds, materializeKit, openTerminal, log, metas, infos }
}

describe('launchDefinition — MCP binding', () => {
  it('static definition launches with --static-mcp <names> before the -- separator', async () => {
    const d = deps(() => ({ ...spec, mcp: { mode: 'static', servers: ['notion', 'github'] } }), ['notion', 'github'])
    await launchDefinition(d as never, 'd1')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toMatch(/sbx run --name my-project-\w+ --static-mcp 'notion,github' -- agents$/)
  })

  it('drops a missing static server, logs it, and still launches with the rest', async () => {
    const d = deps(() => ({ ...spec, mcp: { mode: 'static', servers: ['notion', 'ghost'] } }), ['notion'])
    await launchDefinition(d as never, 'd1')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain('--static-mcp notion')
    expect(cmd).not.toContain('ghost')
    expect(d.infos.some((m) => /ghost/.test(m))).toBe(true)
  })

  it('dynamic binding launches with no MCP flag', async () => {
    const d = deps(() => ({ ...spec, mcp: { mode: 'dynamic', servers: [] } }))
    await launchDefinition(d as never, 'd1')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).not.toContain('--static-mcp')
  })

  it('off/absent binding launches with no MCP flag', async () => {
    const d = deps(() => spec)
    await launchDefinition(d as never, 'd1')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).not.toContain('--static-mcp')
  })
})
