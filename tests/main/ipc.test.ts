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

  it('wraps thrown errors as {ok:false}', async () => {
    const boom: SbxAdapter = { ...adapter, listSandboxes: async () => { throw new Error('kaboom') } }
    const h = buildHandlers({ adapter: boom, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const res = await h['instances:list']()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toBe('kaboom')
  })
})
