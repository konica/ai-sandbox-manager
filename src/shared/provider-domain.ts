import type { AgentId } from './agents'
import { AGENT_PROFILES } from './agents'
import type { Tier } from './types'

/**
 * True when the chosen agent ships no domains of its own, the tier is locked, and no domains
 * have been explicitly added — the resulting kit's network allowlist would be empty, so the
 * agent can't reach any inference endpoint. See AGENT_PROFILES.opencode.domains (deliberately
 * []).
 *
 * Single source of truth for this condition — both the wizard's live hint
 * (`needsProviderDomainHint` in src/renderer/wizard/draft.ts) and the definition-import warning
 * (`def:import` in src/main/ipc.ts) call this rather than re-deriving the rule.
 */
export function needsProviderDomainWarning(agent: AgentId, tier: Tier, domainCount: number): boolean {
  return AGENT_PROFILES[agent].domains.length === 0 && tier === 'locked' && domainCount === 0
}
