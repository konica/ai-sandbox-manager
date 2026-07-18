import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'
import type { DefinitionSpec } from '../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], credentials: []
}

function deps() {
  const openTerminal = vi.fn()
  const adapter = {
    runSbx: vi.fn(), listSandboxes: vi.fn(async () => []),
    createSandbox: vi.fn(), applyPolicy: vi.fn(), publishPorts: vi.fn(),
    stopSandbox: vi.fn(async () => {}), removeSandbox: vi.fn(async () => {})
  }
  const store = {
    getDefinitionSpec: vi.fn(() => spec),
    upsertInstanceMeta: vi.fn(),
    deleteInstanceMeta: vi.fn(),
    listInstanceMeta: vi.fn(() => [])
  }
  const probes = {} as never
  return { adapter, store, probes, openTerminal }
}

describe('instance lifecycle IPC', () => {
  it('instance:launch opens a terminal running the sbx chain and returns the name', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    const r = await h['instance:launch']('d1')
    expect(r).toEqual({ ok: true, data: { name: 'my-project' } })
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain('sbx create claude')
    expect(cmd).toMatch(/sbx run --name my-project$/)
  })

  it('instance:attach and instance:shell open a terminal with the right command', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    await h['instance:attach']('my-project')
    await h['instance:shell']('my-project')
    expect(d.openTerminal).toHaveBeenNthCalledWith(1, "sbx run --name 'my-project'")
    expect(d.openTerminal).toHaveBeenNthCalledWith(2, "sbx exec -it 'my-project' bash")
  })

  it('instance:stop calls the adapter', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    const r = await h['instance:stop']('my-project')
    expect(r.ok).toBe(true)
    expect(d.adapter.stopSandbox).toHaveBeenCalledWith('my-project')
  })

  it('instance:remove removes the sandbox and forgets its metadata', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    const r = await h['instance:remove']('my-project')
    expect(r.ok).toBe(true)
    expect(d.adapter.removeSandbox).toHaveBeenCalledWith('my-project')
    expect(d.store.deleteInstanceMeta).toHaveBeenCalledWith('my-project')
  })
})
