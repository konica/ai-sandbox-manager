import { describe, it, expect } from 'vitest'
import { reconcile } from '@main/reconciler'
import { openStore } from '@main/store/db'
import type { SbxAdapter } from '@main/sbx/adapter'

function fakeAdapter(names: string[]): SbxAdapter {
  return {
    runSbx: async () => ({ stdout: '', stderr: '', code: 0 }),
    listSandboxes: async () => names.map((n) => ({ name: n, status: 'running', agent: 'claude', ports: [], workspace: '/w' }))
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
})
