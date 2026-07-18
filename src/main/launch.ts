import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { resolveSandboxName, agentAttachCommand } from './sbx/translate'
import { SbxError } from '@shared/errors'

export interface LaunchDeps {
  adapter: SbxAdapter
  store: Store
  openTerminal: (command: string) => void
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
  await deps.adapter.createSandbox(spec)
  await deps.adapter.applyPolicy(name, spec.definition.tier, spec.domains)
  await deps.adapter.publishPorts(name, spec.ports)
  deps.store.upsertInstanceMeta({
    sbxName: name,
    definitionId,
    createdByApp: true,
    createdAt: new Date().toISOString()
  })
  deps.openTerminal(agentAttachCommand(name))
  return { name }
}
