import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import type { Logger } from './log'
import { resolveSandboxName, uniqueSandboxName, launchCommand } from './sbx/translate'
import { toSbxName } from '@shared/names'
import { SbxError } from '@shared/errors'

export interface LaunchDeps {
  adapter: Pick<SbxAdapter, 'listSandboxes'>
  store: Store
  openTerminal: (command: string) => void
  log?: Logger
}

/**
 * Launch a sandbox from a stored definition.
 *
 * Provisioning (`sbx create`) and the agent session (`sbx run`) both need a real
 * TTY, so the whole sequence create → policy → ports → run is chained into ONE
 * command and executed in a native terminal window (the app does not block on it).
 *
 * The sandbox name is made unique against both the sandboxes `sbx` already reports
 * and any names the app has already recorded, so relaunching a definition does not
 * fail with "sandbox '<name>' already exists".
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

  const command = launchCommand(spec, name, sessionName)
  deps.log?.info(`Launching sandbox "${name}"${sessionName ? ` (session "${sessionName}")` : ''} from definition ${definitionId} (tier: ${spec.definition.tier}, ports: ${spec.ports.length})`)
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
