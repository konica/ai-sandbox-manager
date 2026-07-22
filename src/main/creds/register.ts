import type { SbxAdapter } from '../sbx/adapter'
import type { CredentialManager } from './manager'
import type { DefinitionSpec } from '@shared/types'
import type { Logger } from '../log'

type Cred = DefinitionSpec['credentials'][number]

export interface RegisterDeps {
  adapter: Pick<SbxAdapter, 'setSecret' | 'setCustomSecret' | 'setRegistrySecret'>
  creds: Pick<CredentialManager, 'getStaged'>
  log?: Logger
}

/**
 * Stable fingerprint of the credential set that sbx bakes into a sandbox at CREATE time
 * (env vars for service/custom creds, registry auth). Used to detect when an instance is
 * out of sync with its definition's credentials and needs a rebuild. Order-independent and
 * value-independent (a changed secret VALUE is re-registered live, no rebuild). Deliberately
 * covers ONLY credentials — network domains/ports apply live and must never trigger a rebuild.
 */
export function credFingerprint(credentials: Cred[]): string {
  return credentials
    .map((c) =>
      c.kind === 'service'
        ? `service:${c.serviceId}:${c.envVar}`
        : c.kind === 'registry'
          ? `registry:${c.host}:${c.scope}`
          : `custom:${c.envVar}:${[...c.domains].sort().join(',')}`
    )
    .sort()
    .join('|')
}

/** Vault key for a credential's staged value — must match the renderer's submit staging. */
export function stageKey(defId: string, c: Cred): string {
  if (c.kind === 'service') return `${defId}:service:${c.serviceId}`
  if (c.kind === 'registry') return `${defId}:registry:${c.id}`
  return `${defId}:custom:${c.id}`
}

/** Scope flags for a registry credential — sandbox-scoped uses the instance name. */
function registryScopeOpts(scope: 'host' | 'global' | 'sandbox', name: string): { global?: boolean; sandbox?: string } {
  if (scope === 'global') return { global: true }
  if (scope === 'sandbox') return { sandbox: name }
  return {} // host-only
}

/**
 * Register a definition's credentials with sbx, scoped to <instanceName>, from this
 * process — never on the terminal command line. Called both pre-create at launch AND on
 * re-attach, so credentials added or changed after the instance was first launched get
 * picked up. `sbx secret set-custom` and the registry set are create-or-update, so
 * re-registering is idempotent; each credential is best-effort (a failure is logged, not
 * fatal), and credentials with no stored value are skipped.
 */
export async function registerCredentials(
  deps: RegisterDeps,
  definitionId: string,
  credentials: Cred[],
  instanceName: string
): Promise<{ registered: number; skipped: number }> {
  if (credentials.length > 0) {
    deps.log?.info(`Registering ${credentials.length} credential(s) scoped to "${instanceName}"…`)
  }
  let registered = 0
  let skipped = 0
  for (const c of credentials) {
    const label = c.kind === 'service'
      ? `service "${c.serviceId}" (${c.envVar})`
      : c.kind === 'registry'
        ? `registry "${c.host}" (${c.scope})`
        : `custom "${c.domains.join(', ')}" (${c.envVar})`
    const value = deps.creds.getStaged(stageKey(definitionId, c))
    if (!value) {
      deps.log?.info(`  ⚠ ${label}: no stored value found — NOT registered. Open the definition's Credentials step and re-enter the value.`)
      skipped++
      continue
    }
    try {
      if (c.kind === 'service') {
        deps.log?.info(`  ${label}: sbx secret set ${instanceName} ${c.serviceId} (value via stdin)`)
        await deps.adapter.setSecret(c.serviceId, value, { sandbox: instanceName })
      } else if (c.kind === 'registry') {
        const opts = registryScopeOpts(c.scope, instanceName)
        const scopeArg = c.scope === 'global' ? '-g' : c.scope === 'sandbox' ? instanceName : '(host-only)'
        deps.log?.info(`  ${label}: sbx secret set ${scopeArg} --registry ${c.host}${c.username ? ` --username ${c.username}` : ''} --password-stdin`)
        await deps.adapter.setRegistrySecret(c.host, c.username, value, opts)
      } else {
        deps.log?.info(`  ${label}: sbx secret set-custom ${instanceName} --host ${c.domains.join(' --host ')} --env ${c.envVar}`)
        await deps.adapter.setCustomSecret(c.domains, c.envVar, value, { sandbox: instanceName })
      }
      registered++
    } catch (e) {
      deps.log?.error(`  ✗ ${label}: registration failed — the agent may run unauthenticated: ${(e as Error).message}`)
    }
  }
  if (credentials.length > 0) {
    deps.log?.info(`Credentials registered: ${registered}${skipped ? `, skipped (no stored value): ${skipped}` : ''}.`)
  }
  return { registered, skipped }
}
