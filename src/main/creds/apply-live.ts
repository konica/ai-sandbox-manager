import type { SbxAdapter } from '../sbx/adapter'
import type { Store } from '../store/db'
import type { CredentialManager } from './manager'
import type { DefinitionSpec } from '@shared/types'
import type { Logger } from '../log'
import { SbxError } from '@shared/errors'
import { credFingerprint, stageKey } from './register'
import { persistentEnvScript, registrySubset } from './persistent'
import { customPlaceholdersForScope, parseInstanceSecrets } from './secret-ls'

export interface ApplyLiveDeps {
  adapter: Pick<SbxAdapter,
    | 'listSandboxes' | 'setSecret' | 'setCustomSecret' | 'removeSecret' | 'removeCustomSecret'
    | 'execScript' | 'listInstanceSecretsRaw'>
  store: Pick<Store, 'updateInstanceFingerprint'>
  creds: Pick<CredentialManager, 'getStaged'>
  log?: Logger
}

/**
 * Reconcile a definition's service/custom credentials onto an ALREADY-RUNNING sandbox — add, UPDATE,
 * and REMOVE — without a recreate:
 *  1. guard the sandbox is running (we exec into it),
 *  2. remove sandbox-scoped secrets that are no longer in the definition (deleted creds),
 *  3. upsert each desired cred with a stored value via remove-then-set, so a CHANGED value actually
 *     overwrites (sbx `set-custom`/`set` don't reliably overwrite in place; `rm -f` + set does),
 *  4. read back each custom secret's dynamic `sbx-cs-…` placeholder from `sbx secret ls <name>` and
 *     inject the env vars into /etc/sandbox-persistent.sh (picked up by the next `sbx run`),
 *  5. clear credential drift by updating the stored fingerprint — but ONLY when the registry subset
 *     is unchanged, so a registry-cred change correctly keeps drift + the Rebuild prompt.
 *
 * Registry creds are excluded (their auth applies only at the next image pull → still Rebuild).
 */
export async function applyCredentialsLive(
  deps: ApplyLiveDeps,
  args: { name: string; definitionId: string; spec: DefinitionSpec; storedFingerprint: string | null }
): Promise<{ applied: number; removed: number; skipped: number }> {
  const { name, definitionId, spec, storedFingerprint } = args

  const inst = (await deps.adapter.listSandboxes()).find((i) => i.name === name)
  if (!inst || inst.status !== 'running') {
    throw new SbxError('not-found', `Sandbox "${name}" is not running. Start or attach it (or use Rebuild) to apply credential changes.`)
  }

  const desired = spec.credentials.filter((c) => c.kind !== 'registry')
  const desiredServiceIds = new Set(desired.flatMap((c) => (c.kind === 'service' ? [c.serviceId] : [])))
  // env var → its desired target hosts (sorted, comma-joined) so we can detect a domain-only edit.
  const desiredCustomHosts = new Map<string, string>()
  for (const c of desired) if (c.kind === 'custom') desiredCustomHosts.set(c.envVar, [...c.domains].sort().join(','))

  // (2) Remove sandbox-scoped secrets that are no longer in the definition. Parsed straight from
  // `sbx secret ls <name>` so we catch anything actually registered, deleted-from-definition or not.
  let removed = 0
  const current = parseInstanceSecrets(await deps.adapter.listInstanceSecretsRaw(name), name)
  for (const svc of current.services) {
    if (desiredServiceIds.has(svc)) continue
    try { await deps.adapter.removeSecret(svc, { sandbox: name }); removed++; deps.log?.info(`  removed stale service secret "${svc}" from "${name}"`) }
    catch (e) { deps.log?.error(`  ✗ could not remove service secret "${svc}": ${(e as Error).message}`) }
  }
  for (const cu of current.customs) {
    if (cu.hosts.length === 0) continue // no host to remove it by — leave it
    // Stale when the env var isn't wanted at all, OR it is wanted but at a DIFFERENT host set (a
    // domain-only edit would otherwise leave the old host grant live indefinitely). The upsert
    // loop below then (re-)registers it at the current hosts.
    const wantHosts = desiredCustomHosts.get(cu.env)
    if (wantHosts !== undefined && wantHosts === [...cu.hosts].sort().join(',')) continue
    try { await deps.adapter.removeCustomSecret(cu.hosts, { sandbox: name }); removed++; deps.log?.info(`  removed stale custom secret "${cu.env}" (${cu.hosts.join(', ')}) from "${name}"`) }
    catch (e) { deps.log?.error(`  ✗ could not remove custom secret "${cu.env}": ${(e as Error).message}`) }
  }

  // (3) Upsert desired creds. remove-then-set so a CHANGED value overwrites (sbx set/set-custom
  // don't reliably overwrite in place; rm -f + set does). A cred with no stored value is left as-is
  // rather than wiped. Note: this necessarily rotates a custom secret's `sbx-cs-…` placeholder on
  // every apply, even for unchanged values — the new block is re-read and injected below, and the
  // agent picks it up on its next run.
  let applied = 0
  let skipped = 0
  for (const c of desired) {
    const label = c.kind === 'service' ? c.serviceId : c.envVar
    const value = deps.creds.getStaged(stageKey(definitionId, c))
    if (!value) {
      skipped++
      deps.log?.info(`  ⚠ ${c.kind} credential "${label}" has no stored value — left unchanged (re-enter it in the definition to update).`)
      continue
    }
    try {
      if (c.kind === 'service') {
        await deps.adapter.removeSecret(c.serviceId, { sandbox: name })
        await deps.adapter.setSecret(c.serviceId, value, { sandbox: name })
        deps.log?.info(`  set service secret "${c.serviceId}" on "${name}"`)
      } else if (c.kind === 'custom') {
        await deps.adapter.removeCustomSecret(c.domains, { sandbox: name })
        await deps.adapter.setCustomSecret(c.domains, c.envVar, value, { sandbox: name })
        deps.log?.info(`  set custom secret "${c.envVar}" (${c.domains.join(', ')}) on "${name}"`)
      }
      applied++
    } catch (e) {
      // remove-then-set is not transactional: if the set failed after the remove succeeded, the
      // value is now MISSING (not merely stale). Flag that clearly so it's diagnosable.
      deps.log?.error(`  ✗ could not set ${c.kind} credential "${label}" — its value may now be MISSING on "${name}" (removed but re-set failed): ${(e as Error).message}`)
    }
  }

  // (4) Read back the (now-current) dynamic placeholders and inject the env block. Services use a
  // static sentinel; custom secrets get the per-sandbox `sbx-cs-…` token the proxy matches.
  let customPlaceholders = new Map<string, string>()
  if (desired.some((c) => c.kind === 'custom')) {
    const raw = await deps.adapter.listInstanceSecretsRaw(name)
    customPlaceholders = customPlaceholdersForScope(raw, name)
    for (const c of desired) {
      if (c.kind === 'custom' && !customPlaceholders.has(c.envVar)) {
        deps.log?.info(`  ⚠ custom secret "${c.envVar}" has no placeholder in \`sbx secret ls\` for "${name}" — not injected.`)
      }
    }
  }
  deps.log?.info(`Injecting credential env placeholders into "${name}" via /etc/sandbox-persistent.sh`)
  await deps.adapter.execScript(name, persistentEnvScript(spec.credentials, customPlaceholders))

  // (5) Clear drift only if registry creds are unchanged (registry still needs Rebuild).
  const wanted = credFingerprint(spec.credentials)
  if (registrySubset(storedFingerprint ?? '') === registrySubset(wanted)) {
    deps.store.updateInstanceFingerprint(name, wanted)
    deps.log?.info(`Credential fingerprint updated for "${name}" — drift cleared.`)
  } else {
    deps.log?.info(`Registry credentials changed for "${name}"; leaving drift set (registry changes need Rebuild).`)
  }

  return { applied, removed, skipped }
}
