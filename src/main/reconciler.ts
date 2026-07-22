import type { InstanceView } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { credFingerprint } from './creds/register'

/**
 * Keep app-created metadata this long after creation even when the sandbox is
 * not yet in `sbx ls` — a freshly launched sandbox is still provisioning in its
 * terminal, so pruning immediately would lose the definition link.
 */
const PROVISION_GRACE_MS = 10 * 60 * 1000

export async function reconcile(
  adapter: SbxAdapter,
  store: Store,
  now: () => number = () => Date.now()
): Promise<InstanceView[]> {
  const instances = await adapter.listSandboxes()
  const liveNames = new Set(instances.map((i) => i.name))
  const metaByName = new Map(store.listInstanceMeta().map((m) => [m.sbxName, m]))
  const nowMs = now()

  // GC: metadata whose sandbox sbx no longer reports — except recently
  // app-created entries still within the provisioning grace window.
  for (const m of metaByName.values()) {
    if (liveNames.has(m.sbxName)) continue
    const created = Date.parse(m.createdAt)
    const provisioning = m.createdByApp && Number.isFinite(created) && nowMs - created < PROVISION_GRACE_MS
    if (!provisioning) store.deleteInstanceMeta(m.sbxName)
  }

  return instances.map((inst) => {
    const meta = metaByName.get(inst.name) ?? null
    const def = meta?.definitionId ? store.getDefinition(meta.definitionId) : null
    // Credential drift: the definition's credentials changed since this instance was created,
    // so its baked-in env vars are stale (→ rebuild). Only credentials count — network/ports
    // apply live. Null fingerprint (pre-v7 instances) → unknown, so never flagged.
    let credsDrift = false
    if (meta?.credFingerprint != null && meta.definitionId) {
      const spec = store.getDefinitionSpec(meta.definitionId)
      if (spec) credsDrift = credFingerprint(spec.credentials) !== meta.credFingerprint
    }
    return {
      ...inst,
      definitionId: def?.id ?? null,
      definitionName: def?.name ?? null,
      tier: def?.tier ?? 'custom',
      credsDrift
    }
  })
}
