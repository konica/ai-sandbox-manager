import { describe, it, expect } from 'vitest'
import { reconcile } from '@main/reconciler'
import { openStore } from '@main/store/db'
import { credFingerprint } from '@main/creds/register'
import type { SbxAdapter } from '@main/sbx/adapter'

function fakeAdapter(names: string[]): SbxAdapter {
  return {
    runSbx: async () => ({ stdout: '', stderr: '', code: 0 }),
    listSandboxes: async () => names.map((n) => ({ name: n, status: 'running', agent: 'claude', ports: [], workspace: '/w' })),
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
}

describe('reconcile', () => {
  it('labels app-created instances with their definition tier', async () => {
    const store = openStore(':memory:')
    store.insertDefinition({ id: 'd1', name: 'prj-alpha', description: '', baseImage: 'img', tier: 'locked', createdAt: 't' })
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: 'd1', createdByApp: true, createdAt: 't' })
    const views = await reconcile(fakeAdapter(['sbx-a']), store)
    expect(views[0]).toMatchObject({ name: 'sbx-a', definitionName: 'prj-alpha', tier: 'locked' })
  })

  it('flags credential drift when the definition gains a credential since the instance was created', async () => {
    const store = openStore(':memory:')
    const base = { id: 'd1', name: 'prj', description: '', baseImage: 'img', tier: 'locked' as const, createdAt: 't' }
    const spec0 = { definition: base, mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [{ kind: 'custom' as const, id: 'a', label: 'A', envVar: 'A', domains: ['a.com'], store: 'encrypted' as const }] }
    store.insertDefinitionSpec(spec0)
    // Instance created with just credential A → fingerprint captured from spec0.
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: 'd1', createdByApp: true, createdAt: 't', credFingerprint: credFingerprint(spec0.credentials) })

    // No drift while the definition is unchanged.
    let views = await reconcile(fakeAdapter(['sbx-a']), store)
    expect(views[0].credsDrift).toBe(false)

    // Add a second credential to the definition → drift.
    store.updateDefinitionSpec({ ...spec0, credentials: [...spec0.credentials, { kind: 'custom' as const, id: 'b', label: 'B', envVar: 'B', domains: ['b.com'], store: 'encrypted' as const }] })
    views = await reconcile(fakeAdapter(['sbx-a']), store)
    expect(views[0].credsDrift).toBe(true)
  })

  it('never flags drift for a change in network domains (applies live, no rebuild)', async () => {
    const store = openStore(':memory:')
    const base = { id: 'd2', name: 'prj2', description: '', baseImage: 'img', tier: 'locked' as const, createdAt: 't' }
    const spec0 = { definition: base, mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }], domains: ['x.com'], ports: [], hostServices: [], credentials: [] }
    store.insertDefinitionSpec(spec0)
    store.upsertInstanceMeta({ sbxName: 'sbx-b', definitionId: 'd2', createdByApp: true, createdAt: 't', credFingerprint: credFingerprint(spec0.credentials) })
    store.updateDefinitionSpec({ ...spec0, domains: ['x.com', 'y.com'] }) // domain change only
    const views = await reconcile(fakeAdapter(['sbx-b']), store)
    expect(views[0].credsDrift).toBe(false)
  })

  it('shows externally-created instances with no definition and custom tier', async () => {
    const store = openStore(':memory:')
    const views = await reconcile(fakeAdapter(['ext-box']), store)
    expect(views[0]).toMatchObject({ name: 'ext-box', definitionId: null, definitionName: null, tier: 'custom' })
  })

  it('garbage-collects metadata for sandboxes sbx no longer reports', async () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'gone', definitionId: null, createdByApp: true, createdAt: 't' })
    await reconcile(fakeAdapter([]), store)
    expect(store.listInstanceMeta()).toHaveLength(0)
  })

  it('keeps recently app-created metadata before the sandbox appears (grace window)', async () => {
    const store = openStore(':memory:')
    const nowMs = Date.parse('2026-07-18T12:00:00.000Z')
    store.upsertInstanceMeta({ sbxName: 'provisioning', definitionId: null, createdByApp: true, createdAt: '2026-07-18T11:59:00.000Z' })
    await reconcile(fakeAdapter([]), store, () => nowMs)
    expect(store.listInstanceMeta().map((m) => m.sbxName)).toContain('provisioning')
  })

  it('prunes app-created metadata once it is past the grace window and still not live', async () => {
    const store = openStore(':memory:')
    const nowMs = Date.parse('2026-07-18T12:00:00.000Z')
    store.upsertInstanceMeta({ sbxName: 'stale', definitionId: null, createdByApp: true, createdAt: '2026-07-18T11:40:00.000Z' })
    await reconcile(fakeAdapter([]), store, () => nowMs)
    expect(store.listInstanceMeta()).toHaveLength(0)
  })
})
