import { describe, it, expect } from 'vitest'
import { reconcile } from '@main/reconciler'
import { openStore } from '@main/store/db'
import type { SbxInstance, DefinitionSpec } from '@shared/types'

function fakeAdapter(instances: SbxInstance[]) {
  return { listSandboxes: async () => instances } as never
}
const live = (name: string, workspace: string | null = null): SbxInstance =>
  ({ name, status: 'running', agent: 'claude', workspace, ports: [] })

describe('reconcile createdAt', () => {
  it('populates createdAt from an existing meta row', async () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'proj-a1', definitionId: null, createdByApp: true, createdAt: '2026-01-02T03:04:05.000Z', credFingerprint: null })
    const views = await reconcile(fakeAdapter([live('proj-a1')]), store)
    expect(views[0].createdAt).toBe('2026-01-02T03:04:05.000Z')
  })

  it('is null for an instance with no metadata row', async () => {
    const store = openStore(':memory:')
    const views = await reconcile(fakeAdapter([live('ghost-1')]), store)
    expect(views[0].createdAt).toBeNull()
  })

  it('is set immediately for a just-adopted workspace-linked instance', async () => {
    const store = openStore(':memory:')
    const spec: DefinitionSpec = {
      definition: { id: 'd1', name: 'Proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: '2026-01-01T00:00:00.000Z' },
      mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
      domains: [], ports: [], hostServices: [], credentials: []
    }
    store.insertDefinitionSpec(spec)
    // instance has no meta row yet, but its workspace matches the definition → adopted this pass
    const views = await reconcile(fakeAdapter([live('proj-cli', '/w')]), store)
    expect(views[0].definitionId).toBe('d1')     // adopted
    expect(views[0].createdAt).not.toBeNull()    // stamped in the same pass, not one poll later
  })
})
