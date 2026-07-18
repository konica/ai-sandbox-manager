import type { InstanceView } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'

export async function reconcile(adapter: SbxAdapter, store: Store): Promise<InstanceView[]> {
  const instances = await adapter.listSandboxes()
  const liveNames = new Set(instances.map((i) => i.name))
  const metaByName = new Map(store.listInstanceMeta().map((m) => [m.sbxName, m]))

  // GC: metadata whose sandbox no longer exists in sbx.
  for (const m of metaByName.values()) {
    if (!liveNames.has(m.sbxName)) store.deleteInstanceMeta(m.sbxName)
  }

  return instances.map((inst) => {
    const meta = metaByName.get(inst.name) ?? null
    const def = meta?.definitionId ? store.getDefinition(meta.definitionId) : null
    return {
      ...inst,
      definitionId: def?.id ?? null,
      definitionName: def?.name ?? null,
      tier: def?.tier ?? 'custom'
    }
  })
}
