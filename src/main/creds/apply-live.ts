import type { SbxAdapter } from '../sbx/adapter'
import type { Store } from '../store/db'
import type { CredentialManager } from './manager'
import type { DefinitionSpec } from '@shared/types'
import type { Logger } from '../log'
import { SbxError } from '@shared/errors'
import { registerCredentials, credFingerprint } from './register'
import { persistentEnvScript, registrySubset } from './persistent'

export interface ApplyLiveDeps {
  adapter: Pick<SbxAdapter, 'listSandboxes' | 'setSecret' | 'setCustomSecret' | 'setRegistrySecret' | 'execScript'>
  store: Pick<Store, 'updateInstanceFingerprint'>
  creds: Pick<CredentialManager, 'getStaged'>
  log?: Logger
}

/**
 * Apply a definition's current credentials to an ALREADY-RUNNING sandbox without a recreate:
 *  1. guard the sandbox is running (we exec into it),
 *  2. register service/custom values with the proxy (reuses registerCredentials; registry excluded
 *     because its auth applies only at the next image pull),
 *  3. inject/refresh the placeholder env vars in /etc/sandbox-persistent.sh (picked up by the next
 *     `sbx run` login shell),
 *  4. clear credential drift by updating the stored fingerprint — but ONLY when the registry subset
 *     is unchanged, so a registry-cred change correctly keeps drift + the Rebuild prompt.
 */
export async function applyCredentialsLive(
  deps: ApplyLiveDeps,
  args: { name: string; definitionId: string; spec: DefinitionSpec; storedFingerprint: string | null }
): Promise<{ applied: number; skipped: number }> {
  const { name, definitionId, spec, storedFingerprint } = args

  const inst = (await deps.adapter.listSandboxes()).find((i) => i.name === name)
  if (!inst || inst.status !== 'running') {
    throw new SbxError('not-found', `Sandbox "${name}" is not running. Start or attach it (or use Rebuild) to apply credential changes.`)
  }

  const live = spec.credentials.filter((c) => c.kind !== 'registry')
  const { registered, skipped } = await registerCredentials(
    { adapter: deps.adapter, creds: deps.creds, log: deps.log },
    definitionId, live, name
  )

  deps.log?.info(`Injecting credential env placeholders into "${name}" via /etc/sandbox-persistent.sh`)
  await deps.adapter.execScript(name, persistentEnvScript(spec.credentials))

  const wanted = credFingerprint(spec.credentials)
  if (registrySubset(storedFingerprint ?? '') === registrySubset(wanted)) {
    deps.store.updateInstanceFingerprint(name, wanted)
    deps.log?.info(`Credential fingerprint updated for "${name}" — drift cleared.`)
  } else {
    deps.log?.info(`Registry credentials changed for "${name}"; leaving drift set (registry changes need Rebuild).`)
  }

  return { applied: registered, skipped }
}
