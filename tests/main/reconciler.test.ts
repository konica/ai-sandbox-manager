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
    execScript: async () => {},
  listInstanceSecretsRaw: async () => '',
    validateKit: async () => ({ code: 0, out: 'ok', ran: true })
  }
}

/** Adapter that reports instances with explicit workspace paths (for auto-link tests). */
function fakeAdapterWorkspaces(instances: Array<{ name: string; workspace: string | null }>): SbxAdapter {
  return {
    ...fakeAdapter([]),
    listSandboxes: async () =>
      instances.map((i) => ({ name: i.name, status: 'running', agent: 'claude', ports: [], workspace: i.workspace }))
  }
}

describe('reconcile', () => {
  it('labels app-created instances with their definition tier', async () => {
    const store = openStore(':memory:')
    store.insertDefinition({ id: 'd1', name: 'prj-alpha', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' })
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: 'd1', createdByApp: true, createdAt: 't' })
    const views = await reconcile(fakeAdapter(['sbx-a']), store)
    expect(views[0]).toMatchObject({ name: 'sbx-a', definitionName: 'prj-alpha', tier: 'locked' })
  })

  it('flags credential drift when the definition gains a credential since the instance was created', async () => {
    const store = openStore(':memory:')
    const base = { id: 'd1', name: 'prj', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't' }
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
    const base = { id: 'd2', name: 'prj2', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't' }
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

  it('auto-links a CLI-created instance to a definition by matching its workspace path', async () => {
    const store = openStore(':memory:')
    const def = { id: 'd1', name: 'Work Sample', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't' }
    store.insertDefinitionSpec({ definition: def, mounts: [{ hostPath: 'C:\\Data\\Projects\\ERRIA\\work_sample', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    // No instance_meta row — the sandbox was started from the CLI, not the app.
    const views = await reconcile(fakeAdapterWorkspaces([{ name: 'work-sample-0ce2cb7a', workspace: 'C:\\Data\\Projects\\ERRIA\\work_sample' }]), store)
    expect(views[0]).toMatchObject({ definitionId: 'd1', definitionName: 'Work Sample', tier: 'locked' })
  })

  it('adopts a workspace-linked instance with no metadata so drift detection works going forward', async () => {
    const store = openStore(':memory:')
    const def = { id: 'd1', name: 'Adopt Me', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't' }
    const spec0 = { definition: def, mounts: [{ hostPath: '/ws', mode: 'direct' as const, isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [{ kind: 'custom' as const, id: 'a', label: 'A', envVar: 'A', domains: ['a.com'], store: 'encrypted' as const }] }
    store.insertDefinitionSpec(spec0)
    // No instance_meta row for this running sandbox (app metadata pruned / CLI-created).
    const adapter = fakeAdapterWorkspaces([{ name: 'adopt-box', workspace: '/ws' }])
    const views = await reconcile(adapter, store)
    // Adopted: a meta row now exists, linked to the definition, with the current fingerprint baseline.
    const meta = store.listInstanceMeta().find((m) => m.sbxName === 'adopt-box')
    expect(meta).toMatchObject({ definitionId: 'd1', createdByApp: false, credFingerprint: credFingerprint(spec0.credentials) })
    expect(views[0].credsDrift).toBe(false) // in sync at adoption time
    // A later credential change to the definition now surfaces as drift.
    store.updateDefinitionSpec({ ...spec0, credentials: [...spec0.credentials, { kind: 'custom' as const, id: 'b', label: 'B', envVar: 'B', domains: ['b.com'], store: 'encrypted' as const }] })
    const views2 = await reconcile(adapter, store)
    expect(views2[0].credsDrift).toBe(true)
  })

  it('backfills a pre-v7 meta row that has no fingerprint baseline (preserving createdByApp)', async () => {
    const store = openStore(':memory:')
    const def = { id: 'd1', name: 'Old', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't' }
    const spec0 = { definition: def, mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [{ kind: 'service' as const, serviceId: 'openai', envVar: 'OPENAI_API_KEY', store: 'sbx' as const }] }
    store.insertDefinitionSpec(spec0)
    store.upsertInstanceMeta({ sbxName: 'old-box', definitionId: 'd1', createdByApp: true, createdAt: 't' }) // no credFingerprint (pre-v7)
    const views = await reconcile(fakeAdapter(['old-box']), store)
    const meta = store.listInstanceMeta().find((m) => m.sbxName === 'old-box')
    expect(meta?.credFingerprint).toBe(credFingerprint(spec0.credentials))
    expect(meta?.createdByApp).toBe(true) // preserved
    expect(views[0].credsDrift).toBe(false) // in sync at backfill time
    // A later credential change now surfaces as drift for the backfilled instance too.
    store.updateDefinitionSpec({ ...spec0, credentials: [...spec0.credentials, { kind: 'custom' as const, id: 'b', label: 'B', envVar: 'B', domains: ['b.com'], store: 'encrypted' as const }] })
    const views2 = await reconcile(fakeAdapter(['old-box']), store)
    expect(views2[0].credsDrift).toBe(true)
  })

  it('matches the workspace path case-insensitively, ignoring slash direction and trailing slash', async () => {
    const store = openStore(':memory:')
    const def = { id: 'd1', name: 'Work Sample', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't' }
    store.insertDefinitionSpec({ definition: def, mounts: [{ hostPath: 'C:\\Data\\Projects\\work_sample', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    const views = await reconcile(fakeAdapterWorkspaces([{ name: 'work-sample-0ce2cb7a', workspace: 'c:/data/projects/work_sample/' }]), store)
    expect(views[0]).toMatchObject({ definitionId: 'd1', definitionName: 'Work Sample' })
  })

  it('does not auto-link when two definitions share the same workspace path (ambiguous)', async () => {
    const store = openStore(':memory:')
    const mounts = [{ hostPath: '/shared', mode: 'direct' as const, isPrimary: true }]
    store.insertDefinitionSpec({ definition: { id: 'd1', name: 'First', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' }, mounts, domains: [], ports: [], hostServices: [], credentials: [] })
    store.insertDefinitionSpec({ definition: { id: 'd2', name: 'Second', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' }, mounts, domains: [], ports: [], hostServices: [], credentials: [] })
    const views = await reconcile(fakeAdapterWorkspaces([{ name: 'box', workspace: '/shared' }]), store)
    expect(views[0]).toMatchObject({ definitionId: null, definitionName: null, tier: 'custom' })
  })

  it('does not auto-link when no definition matches the workspace path', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Other', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/a', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    const views = await reconcile(fakeAdapterWorkspaces([{ name: 'box', workspace: '/b' }]), store)
    expect(views[0]).toMatchObject({ definitionId: null, definitionName: null, tier: 'custom' })
  })

  it('prefers the metadata definition link over a workspace-path match', async () => {
    const store = openStore(':memory:')
    store.insertDefinition({ id: 'd1', name: 'Explicit', description: '', agent: 'claude', baseImage: 'img', tier: 'open', createdAt: 't' })
    store.insertDefinitionSpec({ definition: { id: 'd2', name: 'ByPath', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    store.upsertInstanceMeta({ sbxName: 'box', definitionId: 'd1', createdByApp: true, createdAt: 't' })
    const views = await reconcile(fakeAdapterWorkspaces([{ name: 'box', workspace: '/w' }]), store)
    expect(views[0]).toMatchObject({ definitionId: 'd1', definitionName: 'Explicit' })
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
