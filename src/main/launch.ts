import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import type { CredentialManager } from './creds/manager'
import type { Logger } from './log'
import type { DefinitionSpec } from '@shared/types'
import { randomBytes } from 'crypto'
import { hashedSandboxName, launchCommand, portsForLaunch } from './sbx/translate'
import { registerCredentials, credFingerprint } from './creds/register'
import { toSbxName, composeInstanceBaseName } from '@shared/names'
import { normalizeTags } from '@shared/tags'
import { SbxError } from '@shared/errors'

export interface LaunchDeps {
  adapter: Pick<SbxAdapter, 'listSandboxes' | 'setSecret' | 'setCustomSecret' | 'setRegistrySecret' | 'checkDockerAuth'>
  store: Store
  creds: Pick<CredentialManager, 'getStaged'>
  /** Writes the definition's allowlist kit to disk and returns its dir (or undefined to launch kit-less). */
  materializeKit: (spec: DefinitionSpec, name: string) => string | undefined
  openTerminal: (command: string) => void
  /** Opens the session in VS Code (folder + integrated terminal). Absent → falls back to the terminal. */
  openVSCode?: (command: string, workspaceDir: string, sandboxName: string) => void
  /** Generates the unique instance-name suffix (default: 8 random hex chars). Injected for tests. */
  genHash?: () => string
  log?: Logger
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
  sessionName?: string,
  opener: 'terminal' | 'vscode' = 'terminal',
  rawTags: string[] = []
): Promise<{ name: string }> {
  const spec = deps.store.getDefinitionSpec(definitionId)
  if (!spec) throw new SbxError('not-found', `Definition ${definitionId} not found`)
  const tags = normalizeTags(rawTags)

  // Preflight: a launch needs the sbx client registered with Docker. When it is
  // definitively not (diagnose → Authentication:fail), Docker's remote governance
  // denies every mount and network request ("403 … client not registered"), which
  // would otherwise land as a cryptic error in the terminal. Stop early with an
  // actionable message. 'unknown' (daemon down, old CLI) does NOT block — the real
  // error surfaces at run time as before.
  if (await deps.adapter.checkDockerAuth() === 'fail') {
    deps.log?.error('Launch blocked: sbx client not signed in to Docker (diagnose → Authentication: fail).')
    throw new SbxError('not-authed', 'Sign in to Docker to launch a sandbox: run `sbx login` (and make sure Docker Desktop is running), then launch again.')
  }

  const base = requestedName && requestedName.trim() ? toSbxName(requestedName) : composeInstanceBaseName(spec.definition.name, tags)
  let liveNames: string[] = []
  try {
    liveNames = (await deps.adapter.listSandboxes()).map((i) => i.name)
  } catch (e) {
    deps.log?.error(`Could not list existing sandboxes for name collision check: ${(e as Error).message}`)
  }
  const existing = new Set<string>([...liveNames, ...deps.store.listInstanceMeta().map((m) => m.sbxName)])
  const genHash = deps.genHash ?? (() => randomBytes(4).toString('hex'))
  const name = hashedSandboxName(base, existing, genHash)
  deps.log?.info(`Instance name: "${name}" (unique per launch).`)

  const priorInstances = deps.store.listInstanceMeta().filter((m) => m.definitionId === definitionId).length
  const isSubsequent = priorInstances >= 1
  const ports = portsForLaunch(spec.ports, isSubsequent)
  if (isSubsequent && ports.length < spec.ports.length) {
    deps.log?.info(`Instance #${priorInstances + 1} of definition ${definitionId}: skipping ${spec.ports.length - ports.length} fixed host-port forward(s) to avoid conflicts. Add corrected ports from the instance's Ports tab.`)
  }

  // Register secrets scoped to <name>, pre-create, from this process (never in the terminal).
  // Shared with the re-attach path so credentials stay in sync with the definition.
  await registerCredentials({ adapter: deps.adapter, creds: deps.creds, log: deps.log }, definitionId, spec.credentials, name)

  const kitDir = deps.materializeKit(spec, name)
  const command = launchCommand(spec, name, sessionName, kitDir, ports)
  deps.log?.info(`Launching sandbox "${name}"${sessionName ? ` (session "${sessionName}")` : ''} from definition ${definitionId} (tier: ${spec.definition.tier}, creds: ${spec.credentials.length}, ports: ${spec.ports.length})`)
  deps.log?.info(`Opening terminal to provision and run: ${command}`)

  deps.store.upsertInstanceMeta({
    sbxName: name,
    definitionId,
    createdByApp: true,
    createdAt: new Date().toISOString(),
    // Record the credential set baked into this sandbox so later credential changes to the
    // definition can be flagged as drift (→ needs rebuild). See reconcile().
    credFingerprint: credFingerprint(spec.credentials)
  })
  deps.store.setInstanceTags(name, tags)
  const primary = spec.mounts.find((m) => m.isPrimary) ?? spec.mounts[0]
  const workspaceDir = primary?.hostPath?.trim()
  if (opener === 'vscode' && deps.openVSCode && workspaceDir) {
    deps.log?.info(`Opening VS Code at ${workspaceDir} (session in integrated terminal) for "${name}".`)
    deps.openVSCode(command, workspaceDir, name)
  } else {
    if (opener === 'vscode') deps.log?.info('VS Code opener unavailable; falling back to Terminal.')
    deps.openTerminal(command)
  }

  deps.log?.info(`Session opened for "${name}". Watch that window for provisioning progress.`)
  return { name }
}
