import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import type { CredentialManager } from './creds/manager'
import type { Logger } from './log'
import type { DefinitionSpec } from '@shared/types'
import { resolveSandboxName, uniqueSandboxName, launchCommand } from './sbx/translate'
import { toSbxName } from '@shared/names'
import { SbxError } from '@shared/errors'

export interface LaunchDeps {
  adapter: Pick<SbxAdapter, 'listSandboxes' | 'setSecret' | 'setCustomSecret' | 'setRegistrySecret'>
  store: Store
  creds: Pick<CredentialManager, 'getStaged'>
  /** Writes the definition's allowlist kit to disk and returns its dir (or undefined to launch kit-less). */
  materializeKit: (spec: DefinitionSpec, name: string) => string | undefined
  openTerminal: (command: string) => void
  log?: Logger
}

/** Vault key for a credential's staged value — must match the renderer's submit staging. */
function stageKey(defId: string, c: DefinitionSpec['credentials'][number]): string {
  if (c.kind === 'service') return `${defId}:service:${c.serviceId}`
  if (c.kind === 'registry') return `${defId}:registry:${c.id}`
  return `${defId}:custom:${c.id}`
}

/** Scope flags for a registry credential — sandbox-scoped uses the launched name. */
function registryScopeOpts(scope: 'host' | 'global' | 'sandbox', name: string): { global?: boolean; sandbox?: string } {
  if (scope === 'global') return { global: true }
  if (scope === 'sandbox') return { sandbox: name }
  return {} // host-only
}

/**
 * Launch a sandbox from a stored definition.
 *
 * Provisioning (`sbx create`) and the agent session (`sbx run`) both need a real TTY,
 * so create → ports → run is chained into ONE command run in a native terminal.
 *
 * Credentials are registered from THIS process, sandbox-scoped, BEFORE the terminal opens
 * (verified in the Phase 0 spike): `sbx secret set` for built-in services and
 * `sbx secret set-custom` for custom ones. Registering against the (not-yet-created) unique
 * name means `sbx create` picks up the in-VM env vars automatically — no global secrets, and
 * no secret ever touches the terminal command line. A network-allowlist kit provides
 * reachability; the kit carries no secrets.
 */
export async function launchDefinition(
  deps: LaunchDeps,
  definitionId: string,
  requestedName?: string,
  sessionName?: string
): Promise<{ name: string }> {
  const spec = deps.store.getDefinitionSpec(definitionId)
  if (!spec) throw new SbxError('not-found', `Definition ${definitionId} not found`)

  const base = requestedName && requestedName.trim() ? toSbxName(requestedName) : resolveSandboxName(spec)
  let liveNames: string[] = []
  try {
    liveNames = (await deps.adapter.listSandboxes()).map((i) => i.name)
  } catch (e) {
    deps.log?.error(`Could not list existing sandboxes for name collision check: ${(e as Error).message}`)
  }
  const existing = new Set<string>([...liveNames, ...deps.store.listInstanceMeta().map((m) => m.sbxName)])
  const name = uniqueSandboxName(base, existing)
  if (name !== base) deps.log?.info(`Name "${base}" is already in use; using "${name}" instead.`)

  // Register secrets scoped to <name>, pre-create, from this process (never in the terminal).
  if (spec.credentials.length > 0) {
    deps.log?.info(`Registering ${spec.credentials.length} credential(s) scoped to "${name}" before provisioning…`)
  }
  let registered = 0
  let skipped = 0
  for (const c of spec.credentials) {
    const label = c.kind === 'service'
      ? `service "${c.serviceId}" (${c.envVar})`
      : c.kind === 'registry'
        ? `registry "${c.host}" (${c.scope})`
        : `custom "${c.domains.join(', ')}" (${c.envVar})`
    const value = deps.creds.getStaged(stageKey(definitionId, c))
    if (!value) {
      deps.log?.info(`  ⚠ ${label}: no stored value found — NOT registered. Open the definition's Credentials step and re-enter the value, then relaunch.`)
      skipped++
      continue
    }
    try {
      if (c.kind === 'service') {
        deps.log?.info(`  ${label}: sbx secret set ${name} ${c.serviceId} (value via stdin)`)
        await deps.adapter.setSecret(c.serviceId, value, { sandbox: name })
      } else if (c.kind === 'registry') {
        const opts = registryScopeOpts(c.scope, name)
        const scopeArg = c.scope === 'global' ? '-g' : c.scope === 'sandbox' ? name : '(host-only)'
        deps.log?.info(`  ${label}: sbx secret set ${scopeArg} --registry ${c.host}${c.username ? ` --username ${c.username}` : ''} --password-stdin`)
        await deps.adapter.setRegistrySecret(c.host, c.username, value, opts)
      } else {
        deps.log?.info(`  ${label}: sbx secret set-custom ${name} --host ${c.domains.join(' --host ')} --env ${c.envVar}`)
        await deps.adapter.setCustomSecret(c.domains, c.envVar, value, { sandbox: name })
      }
      registered++
    } catch (e) {
      deps.log?.error(`  ✗ ${label}: registration failed — the agent may launch unauthenticated: ${(e as Error).message}`)
    }
  }
  if (spec.credentials.length > 0) {
    deps.log?.info(`Credentials registered: ${registered}${skipped ? `, skipped (no stored value): ${skipped}` : ''}.`)
  }

  const kitDir = deps.materializeKit(spec, name)
  const command = launchCommand(spec, name, sessionName, kitDir)
  deps.log?.info(`Launching sandbox "${name}"${sessionName ? ` (session "${sessionName}")` : ''} from definition ${definitionId} (tier: ${spec.definition.tier}, creds: ${spec.credentials.length}, ports: ${spec.ports.length})`)
  deps.log?.info(`Opening terminal to provision and run: ${command}`)

  deps.store.upsertInstanceMeta({
    sbxName: name,
    definitionId,
    createdByApp: true,
    createdAt: new Date().toISOString()
  })
  deps.openTerminal(command)

  deps.log?.info(`Terminal opened for "${name}". Watch that window for provisioning progress.`)
  return { name }
}
