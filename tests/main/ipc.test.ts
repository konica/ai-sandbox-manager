import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))

import { buildHandlers } from '@main/ipc'
import { openStore } from '@main/store/db'
import type { SbxAdapter } from '@main/sbx/adapter'
import type { Probes } from '@main/prereq'

const adapter: SbxAdapter = {
  runSbx: async () => ({ stdout: '', stderr: '', code: 0 }),
  listSandboxes: async () => [{ name: 'sbx-a', status: 'running', agent: 'claude', ports: [], workspace: '/w' }],
  createSandbox: async () => {},
  applyPolicy: async () => {},
  publishPorts: async () => {},
  stopSandbox: async () => {},
  removeSandbox: async () => {},
  setSecret: async () => {},
  removeSecret: async () => {},
  listGlobalSecretsRaw: async () => '',
  setCustomSecret: async () => {},
  removeCustomSecret: async () => {},
  setRegistrySecret: async () => {},
  removeRegistrySecret: async () => {},
    listPorts: async () => [], publishPort: async () => {}, unpublishPort: async () => {}, allowNetwork: async () => {}, removeNetwork: async () => {}, policyLog: async () => ({ allowed: 0, blocked: 0, events: [] })
}
const probes: Probes = {
  dockerVersion: async () => 'Docker version 24.0.7', sbxVersion: async () => 'sbx 1.0', sbxAuthed: async () => true,
  freeDiskBytes: async () => 50 * 1024 ** 3, keychainReachable: async () => true
}

describe('buildHandlers', () => {
  it('prereq:check returns a wrapped ok result', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const res = await h['prereq:check']()
    expect(res).toEqual({ ok: true, data: expect.objectContaining({ ok: true }) })
  })

  it('instances:list returns reconciled views', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const res = await h['instances:list']()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data[0].name).toBe('sbx-a')
  })

  it('auth:status returns the parsed Claude auth kind', async () => {
    const authed: SbxAdapter = { ...adapter, listGlobalSecretsRaw: async () => '(global)   service   anthropic   (oauth configured)' }
    const h = buildHandlers({ adapter: authed, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const r = await h['auth:status']()
    expect(r.ok && r.data.anthropic).toBe('oauth')
  })

  it('auth:launchPrecheck flags a nudge for a no-credential definition when signed out', async () => {
    const store = openStore(":memory:")
    store.insertDefinitionSpec({
      definition: { id: 'd', name: 'n', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
      mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    })
    const signedOut: SbxAdapter = { ...adapter, listGlobalSecretsRaw: async () => 'No secrets found for scope "(global)".' }
    const h = buildHandlers({ adapter: signedOut, store, probes, openTerminal: () => {} })
    const r = await h['auth:launchPrecheck']('d')
    expect(r.ok && r.data.needsNudge).toBe(true)
    expect(r.ok && r.data.status).toBe('none')
  })

  it('ssh:detect reports whether SSH_AUTH_SOCK is present', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {}, readLoginEnv: () => ({ SSH_AUTH_SOCK: '/tmp/s.sock' }) })
    const r = await h['ssh:detect']()
    expect(r.ok && r.data.present).toBe(true)
  })

  it('env:hasVSCode reports code availability', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const r = await h['env:hasVSCode']()
    expect(r.ok).toBe(true)
    if (r.ok) expect(typeof r.data.present).toBe('boolean')
  })
  it('instance:attach with vscode opener resolves the workspace and opens VS Code', async () => {
    const store = openStore(":memory:")
    store.insertDefinitionSpec({
      definition: { id: 'd', name: 'n', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
      mounts: [{ hostPath: '/ws', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    })
    store.upsertInstanceMeta({ sbxName: 'box', definitionId: 'd', createdByApp: true, createdAt: 't' })
    const openVSCode = vi.fn()
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, openVSCode })
    await h['instance:attach']('box', 'vscode')
    expect(openVSCode).toHaveBeenCalledTimes(1)
    expect(openVSCode.mock.calls[0][1]).toBe('/ws')
  })

  it('instance:commands returns the manual agent + shell commands', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const r = await h['instance:commands']('box')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.agent).toContain('sbx run --name')
      expect(r.data.agent).toContain('box')
      expect(r.data.agent).toContain('--continue')
      expect(r.data.shell).toContain('sbx exec -it')
      expect(r.data.shell).toContain('bash')
    }
  })

  it('def:export builds a bundle for selected ids and writes it via saveFile', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Alpha', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    let written = ''
    const saveFile = async (_name: string, contents: string): Promise<string | null> => { written = contents; return '/tmp/out.sbx.json' }
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, saveFile })
    const r = await h['def:export'](['d1'])
    expect(r.ok && r.data.path).toBe('/tmp/out.sbx.json')
    expect(r.ok && r.data.count).toBe(1)
    expect(JSON.parse(written).kind).toBe('sandbox-definitions')
    expect(JSON.parse(written).definitions[0].definition.name).toBe('Alpha')
  })
  it('def:export returns canceled when the save dialog is dismissed', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Alpha', description: '', baseImage: 'i', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, saveFile: async () => null })
    const r = await h['def:export'](['d1'])
    expect(r.ok && r.data.canceled).toBe(true)
  })
  it('def:import inserts each definition as a new copy with a fresh id and deduped name', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({ definition: { id: 'existing', name: 'Alpha', description: '', baseImage: 'i', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    const bundle = JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now', definitions: [
      { definition: { name: 'Alpha', description: '', baseImage: 'i', tier: 'locked' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }
    ] })
    let n = 0
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, openFile: async () => ({ path: '/tmp/in.sbx.json', contents: bundle }), genId: () => `new-${n++}` })
    const r = await h['def:import']()
    expect(r.ok && r.data.imported).toEqual(['Alpha (imported)'])
    expect(store.listDefinitions().map((d) => d.name).sort()).toEqual(['Alpha', 'Alpha (imported)'])
    expect(store.getDefinitionSpec('new-0')).not.toBeNull()
  })
  it('def:remove deletes the definition and removes its instances', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Alpha', description: '', baseImage: 'i', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    store.upsertInstanceMeta({ sbxName: 'alpha-1', definitionId: 'd1', createdByApp: true, createdAt: 't' })
    store.upsertInstanceMeta({ sbxName: 'alpha-2', definitionId: 'd1', createdByApp: true, createdAt: 't' })
    const removeSandbox = vi.fn(async () => {})
    const h = buildHandlers({ adapter: { ...adapter, removeSandbox }, store, probes, openTerminal: () => {}, cleanupKit: () => {} })
    const r = await h['def:remove']('d1')
    expect(r.ok && r.data.removedInstances).toBe(2)
    expect(removeSandbox).toHaveBeenCalledTimes(2)
    expect(store.getDefinitionSpec('d1')).toBeNull()
    expect(store.listInstanceMeta().filter((m) => m.definitionId === 'd1')).toEqual([])
  })

  it('def:import surfaces an error for a malformed file', async () => {
    const h = buildHandlers({ adapter, store: openStore(':memory:'), probes, openTerminal: () => {}, openFile: async () => ({ path: '/tmp/x', contents: 'not json' }) })
    const r = await h['def:import']()
    expect(r.ok).toBe(false)
  })

  it('wraps thrown errors as {ok:false}', async () => {
    const boom: SbxAdapter = { ...adapter, listSandboxes: async () => { throw new Error('kaboom') } }
    const h = buildHandlers({ adapter: boom, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const res = await h['instances:list']()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toBe('kaboom')
  })
})
