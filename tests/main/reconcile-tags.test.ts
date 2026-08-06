import { describe, it, expect } from 'vitest'
import { reconcile } from '@main/reconciler'
import { openStore } from '@main/store/db'
import type { SbxInstance } from '@shared/types'

function fakeAdapter(instances: SbxInstance[]) {
  return { listSandboxes: async () => instances } as never
}

describe('reconcile attaches tags', () => {
  it('populates InstanceView.tags from the store', async () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'proj-a1', definitionId: null, createdByApp: true, createdAt: new Date().toISOString(), credFingerprint: null })
    store.setInstanceTags('proj-a1', ['prod', 'eu'])
    const views = await reconcile(fakeAdapter([{ name: 'proj-a1', status: 'running', agent: 'claude', workspace: null, ports: [] }]), store)
    expect(views[0].tags).toEqual(['prod', 'eu'])
  })
  it('defaults to an empty array for untagged instances', async () => {
    const store = openStore(':memory:')
    const views = await reconcile(fakeAdapter([{ name: 'x-1', status: 'running', agent: 'claude', workspace: null, ports: [] }]), store)
    expect(views[0].tags).toEqual([])
  })
})

describe('reconcile prunes orphan tag rows', () => {
  it('deletes tags for a name that is neither live nor tracked in instance_meta', async () => {
    const store = openStore(':memory:')
    store.setInstanceTags('ghost-1', ['x'])
    await reconcile(fakeAdapter([{ name: 'proj-a1', status: 'running', agent: 'claude', workspace: null, ports: [] }]), store)
    expect(store.listInstanceTags().has('ghost-1')).toBe(false)
  })
  it('does not prune tags for a live instance', async () => {
    const store = openStore(':memory:')
    store.setInstanceTags('proj-a1', ['prod'])
    await reconcile(fakeAdapter([{ name: 'proj-a1', status: 'running', agent: 'claude', workspace: null, ports: [] }]), store)
    expect(store.listInstanceTags().get('proj-a1')).toEqual(['prod'])
  })
})
