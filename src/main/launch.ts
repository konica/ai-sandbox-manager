import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import type { Logger } from './log'
import { resolveSandboxName, agentAttachCommand } from './sbx/translate'
import { SbxError } from '@shared/errors'

export interface LaunchDeps {
  adapter: SbxAdapter
  store: Store
  openTerminal: (command: string) => void
  log?: Logger
}

/**
 * Launch a running sandbox from a stored definition:
 *   provision → apply network tier → publish ports → record link → attach agent.
 * The sandbox name is resolved once and used for both `sbx` and the metadata row.
 */
export async function launchDefinition(deps: LaunchDeps, definitionId: string): Promise<{ name: string }> {
  const spec = deps.store.getDefinitionSpec(definitionId)
  if (!spec) throw new SbxError('not-found', `Definition ${definitionId} not found`)

  const name = resolveSandboxName(spec)
  const image = spec.definition.baseImage.trim() || 'agent default image'
  deps.log?.info(`Launching "${name}" from definition ${definitionId}`)

  deps.log?.info(`Provisioning sandbox (template: ${image}, tier: ${spec.definition.tier})…`)
  await deps.adapter.createSandbox(spec)

  deps.log?.info(`Applying network policy for tier "${spec.definition.tier}"…`)
  await deps.adapter.applyPolicy(name, spec.definition.tier, spec.domains)

  if (spec.ports.length > 0) deps.log?.info(`Publishing ${spec.ports.length} port intent(s)…`)
  await deps.adapter.publishPorts(name, spec.ports)

  deps.log?.info('Recording instance metadata…')
  deps.store.upsertInstanceMeta({
    sbxName: name,
    definitionId,
    createdByApp: true,
    createdAt: new Date().toISOString()
  })

  const attachCmd = agentAttachCommand(name)
  deps.log?.info(`Opening agent terminal: ${attachCmd}`)
  deps.openTerminal(attachCmd)

  deps.log?.info(`Launch complete for "${name}".`)
  return { name }
}
