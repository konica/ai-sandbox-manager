import { describe, it, expect } from 'vitest'
import { reconcile } from '@main/reconciler'
import { openStore } from '@main/store/db'
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
    listPorts: async () => [], publishPort: async () => {}, unpublishPort: async () => {}, allowNetwork: async () => {}, removeNetwork: async () => {}, policyLog: async () => ({ allowed: 0, blocked: 0, events: [] }), checkDockerAuth: async () => 'pass'
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
