import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'
import { openStore, type Store } from '../../src/main/store/db'
import type { DefinitionSpec } from '../../src/shared/types'

function seed(store: Store): void {
  const spec: DefinitionSpec = {
    definition: { id: 'd1', name: 'P', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
  }
  store.insertDefinitionSpec(spec)
  store.upsertInstanceMeta({ sbxName: 'box', definitionId: 'd1', createdByApp: true, createdAt: 't' })
}

let store: Store
function deps() {
  const adapter = {
    listPorts: vi.fn(async () => [{ hostPort: 8080, containerPort: 3000, protocol: 'tcp' }]),
    publishPort: vi.fn(async () => {}), unpublishPort: vi.fn(async () => {}),
    allowNetwork: vi.fn(async () => {}), removeNetwork: vi.fn(async () => {})
  }
  return { d: { adapter, store, probes: {}, openTerminal: vi.fn() } as never, adapter }
}

beforeEach(() => { store = openStore(':memory:'); seed(store) })

describe('live ports + network IPC (dual-write)', () => {
  it('lists live ports', async () => {
    const { d } = deps()
    const r = await buildHandlers(d)['instance:ports:list']('box')
    expect(r.ok && r.data).toEqual([{ hostPort: 8080, containerPort: 3000, protocol: 'tcp' }])
  })
  it('publish: live op + persists the port to the definition', async () => {
    const { d, adapter } = deps()
    const port = { hostPort: 9229, containerPort: 9229, protocol: 'tcp' }
    await buildHandlers(d)['instance:ports:publish']('box', port)
    expect(adapter.publishPort).toHaveBeenCalledWith('box', port)
    expect(store.getDefinitionSpec('d1')!.ports).toContainEqual({ ...port, label: '' })
  })
  it('unpublish: live op + removes the port from the definition', async () => {
    const { d } = deps()
    const port = { hostPort: 9229, containerPort: 9229, protocol: 'tcp' }
    await buildHandlers(d)['instance:ports:publish']('box', port)
    await buildHandlers(d)['instance:ports:unpublish']('box', port)
    expect(store.getDefinitionSpec('d1')!.ports).toEqual([])
  })
  it('host service add: allowNetwork localhost:<port> + persists', async () => {
    const { d, adapter } = deps()
    await buildHandlers(d)['instance:hostService:add']('box', 11434, 'Ollama')
    expect(adapter.allowNetwork).toHaveBeenCalledWith('box', 'localhost:11434')
    expect(store.getDefinitionSpec('d1')!.hostServices).toEqual([{ hostPort: 11434, label: 'Ollama' }])
  })
  it('host service remove: removeNetwork + persists', async () => {
    const { d, adapter } = deps()
    await buildHandlers(d)['instance:hostService:add']('box', 11434, 'Ollama')
    await buildHandlers(d)['instance:hostService:remove']('box', 11434)
    expect(adapter.removeNetwork).toHaveBeenCalledWith('box', 'localhost:11434')
    expect(store.getDefinitionSpec('d1')!.hostServices).toEqual([])
  })
  it('domain allow/deny: allowNetwork/removeNetwork + persists', async () => {
    const { d, adapter } = deps()
    await buildHandlers(d)['instance:domain:allow']('box', 'api.example.com')
    expect(adapter.allowNetwork).toHaveBeenCalledWith('box', 'api.example.com')
    expect(store.getDefinitionSpec('d1')!.domains).toEqual(['api.example.com'])
    await buildHandlers(d)['instance:domain:deny']('box', 'api.example.com')
    expect(adapter.removeNetwork).toHaveBeenCalledWith('box', 'api.example.com')
    expect(store.getDefinitionSpec('d1')!.domains).toEqual([])
  })
})
