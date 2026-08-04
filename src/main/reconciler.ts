import type { Definition, InstanceView } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { credFingerprint } from './creds/register'

/**
 * Keep app-created metadata this long after creation even when the sandbox is
 * not yet in `sbx ls` — a freshly launched sandbox is still provisioning in its
 * terminal, so pruning immediately would lose the definition link.
 */
const PROVISION_GRACE_MS = 10 * 60 * 1000

/**
 * Normalise a host path for comparison across the two sources that must agree:
 * the definition's stored primary-mount `hostPath` and the `workspace` the sbx
 * CLI reports. Fold slash direction and trailing slashes; lower-case so Windows
 * and macOS (case-insensitive filesystems) match regardless of how the path was
 * typed. Deliberately case-insensitive: two real workspaces differing only by
 * case is a non-issue in practice, and mislabelling is the failure we avoid.
 */
function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Index definitions by their normalised primary-mount host path so an instance
 * with no app-written metadata (e.g. one started from the CLI) can still be
 * linked to its definition by matching the workspace path `sbx ls` reports.
 * A path shared by two or more definitions is ambiguous and left unmapped —
 * we never guess a definition when the workspace alone can't identify it.
 */
function buildWorkspaceIndex(store: Store): Map<string, Definition> {
  const seen = new Map<string, Definition | null>() // null marks an ambiguous (multi-definition) path
  for (const def of store.listDefinitions()) {
    const spec = store.getDefinitionSpec(def.id)
    const primary = spec?.mounts.find((m) => m.isPrimary) ?? spec?.mounts[0]
    if (!primary?.hostPath) continue
    const key = normalizePath(primary.hostPath)
    seen.set(key, seen.has(key) ? null : def)
  }
  const index = new Map<string, Definition>()
  for (const [key, def] of seen) if (def) index.set(key, def)
  return index
}

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

  const workspaceIndex = buildWorkspaceIndex(store)

  return instances.map((inst) => {
    const meta = metaByName.get(inst.name) ?? null
    // Prefer the explicit metadata link (written when the app launched the sandbox);
    // fall back to matching the workspace path so CLI-created instances auto-link too.
    const def =
      (meta?.definitionId ? store.getDefinition(meta.definitionId) : null) ??
      (inst.workspace ? workspaceIndex.get(normalizePath(inst.workspace)) ?? null : null)
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
