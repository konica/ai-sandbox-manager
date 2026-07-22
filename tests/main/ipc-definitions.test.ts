import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))

import { buildHandlers } from '@main/ipc'
import { openStore } from '@main/store/db'
import type { SbxAdapter } from '@main/sbx/adapter'
import type { Probes } from '@main/prereq'
import type { DefinitionSpec } from '@shared/types'

const adapter: SbxAdapter = {
  runSbx: async () => ({ stdout: '', stderr: '', code: 0 }),
  listSandboxes: async () => [],
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
    listPorts: async () => [], publishPort: async () => {}, unpublishPort: async () => {}, allowNetwork: async () => {}, removeNetwork: async () => {}, policyLog: async () => ({ allowed: 0, blocked: 0, events: [] }), checkDockerAuth: async () => 'pass',
  validateKit: async () => ({ code: 0, out: 'ok', ran: true })
}
const probes: Probes = {
  dockerVersion: async () => 'Docker version 24.0.7', sbxVersion: async () => 'sbx 1.0', sbxAuthed: async () => true,
  freeDiskBytes: async () => 50 * 1024 ** 3, keychainReachable: async () => true
}

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'prj-alpha', description: '', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' },
  mounts: [], domains: [], ports: [], hostServices: [], credentials: []
}

describe('definition IPC handlers', () => {
  it('def:create persists the spec and returns its id', async () => {
    const store = openStore(':memory:')
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {} })
    const res = await h['def:create'](spec)
    expect(res).toEqual({ ok: true, data: { id: 'd1' } })
    expect(store.getDefinitionSpec('d1')).not.toBeNull()
  })

  it('def:list returns the persisted definitions', async () => {
    const store = openStore(':memory:')
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {} })
    await h['def:create'](spec)
    const res = await h['def:list']()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.map((d) => d.name)).toEqual(['prj-alpha'])
  })

  it('def:getSpec returns the full spec, and def:update replaces it', async () => {
    const store = openStore(':memory:')
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {} })
    await h['def:create'](spec)

    const got = await h['def:getSpec']('d1')
    expect(got.ok && got.data?.definition.name).toBe('prj-alpha')

    const updated = { ...spec, definition: { ...spec.definition, name: 'prj-beta', tier: 'open' as const }, domains: ['x.com'] }
    const up = await h['def:update'](updated)
    expect(up).toEqual({ ok: true, data: { id: 'd1' } })

    const after = await h['def:getSpec']('d1')
    expect(after.ok && after.data?.definition.name).toBe('prj-beta')
    expect(after.ok && after.data?.definition.tier).toBe('open')
    expect(after.ok && after.data?.domains).toEqual(['x.com'])
  })

  it('def:update wraps a missing definition as {ok:false}', async () => {
    const store = openStore(':memory:')
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {} })
    const res = await h['def:update'](spec) // never created
    expect(res.ok).toBe(false)
  })

  it('def:create wraps failures as {ok:false}', async () => {
    const store = openStore(':memory:')
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {} })
    await h['def:create'](spec)
    const dup = await h['def:create'](spec) // duplicate primary key
    expect(dup.ok).toBe(false)
  })
})
