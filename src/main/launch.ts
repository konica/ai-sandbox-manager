import type { Store } from './store/db'
import type { Logger } from './log'
import { resolveSandboxName, launchCommand } from './sbx/translate'
import { SbxError } from '@shared/errors'

export interface LaunchDeps {
  store: Store
  openTerminal: (command: string) => void
  log?: Logger
}

/**
 * Launch a sandbox from a stored definition.
 *
 * Provisioning (`sbx create`) and the agent session (`sbx run`) both need a real
 * TTY — `sbx create` spawned from the background main process never returns, and
 * the agent is interactive by nature. So the whole sequence
 *   create → apply network tier → publish ports → run
 * is chained into ONE command and executed in a native terminal window. The app
 * does not block on it; the terminal shows provisioning progress and hosts the agent.
 */
export async function launchDefinition(deps: LaunchDeps, definitionId: string): Promise<{ name: string }> {
  const spec = deps.store.getDefinitionSpec(definitionId)
  if (!spec) throw new SbxError('not-found', `Definition ${definitionId} not found`)

  const name = resolveSandboxName(spec)
  const command = launchCommand(spec)

  deps.log?.info(`Launching "${name}" from definition ${definitionId} (tier: ${spec.definition.tier}, ports: ${spec.ports.length})`)
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
