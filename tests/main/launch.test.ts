import { describe, it, expect, vi } from 'vitest'
import { launchDefinition } from '../../src/main/launch'
import type { DefinitionSpec, InstanceMeta } from '../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: ['api.example.com'],
  ports: [{ hostPort: 3000, containerPort: 8080, label: 'web' }],
  credentials: []
}

function deps(getSpec: () => DefinitionSpec | undefined) {
  const order: string[] = []
  const metas: InstanceMeta[] = []
  const adapter = {
    runSbx: vi.fn(), listSandboxes: vi.fn(),
    createSandbox: vi.fn(async () => { order.push('create') }),
    applyPolicy: vi.fn(async () => { order.push('policy') }),
    publishPorts: vi.fn(async () => { order.push('ports') }),
    stopSandbox: vi.fn(), removeSandbox: vi.fn()
  }
  const store = {
    getDefinitionSpec: vi.fn(getSpec),
    upsertInstanceMeta: vi.fn((m: InstanceMeta) => { order.push('meta'); metas.push(m) })
  } as never
  const openTerminal = vi.fn(() => { order.push('terminal') })
  return { adapter, store, openTerminal, order, metas }
}

describe('launchDefinition', () => {
  it('provisions, applies policy, publishes ports, records meta, then opens the agent terminal — in that order', async () => {
    const d = deps(() => spec)
    const res = await launchDefinition(d as never, 'd1')
    expect(res.name).toBe('my-project')
    expect(d.order).toEqual(['create', 'policy', 'ports', 'meta', 'terminal'])
    expect(d.adapter.applyPolicy).toHaveBeenCalledWith('my-project', 'locked', ['api.example.com'])
    expect(d.openTerminal).toHaveBeenCalledWith("sbx run --name 'my-project'")
  })

  it('records meta linking the sandbox to the definition as app-created', async () => {
    const d = deps(() => spec)
    await launchDefinition(d as never, 'd1')
    expect(d.metas[0].sbxName).toBe('my-project')
    expect(d.metas[0].definitionId).toBe('d1')
    expect(d.metas[0].createdByApp).toBe(true)
  })

  it('throws not-found when the definition is missing', async () => {
    const d = deps(() => undefined)
    await expect(launchDefinition(d as never, 'nope')).rejects.toThrow(/not found/i)
    expect(d.adapter.createSandbox).not.toHaveBeenCalled()
  })

  it('logs launch milestones when a logger is provided', async () => {
    const infos: string[] = []
    const d = deps(() => spec) as Record<string, unknown>
    d.log = { info: (m: string) => infos.push(m), command: () => {}, error: () => {} }
    await launchDefinition(d as never, 'd1')
    expect(infos.some((l) => /Launching "my-project"/.test(l))).toBe(true)
    expect(infos.some((l) => /network policy/i.test(l))).toBe(true)
    expect(infos.some((l) => /Launch complete/.test(l))).toBe(true)
  })
})
