import type { SbxStatus, Tier } from '@shared/types'
import type { McpAuthState } from '@shared/mcp'
import { useT } from '../i18n'

const TIER_CLASS: Record<Tier | 'custom', string> = {
  open: 'tier-open',
  balanced: 'tier-balanced',
  locked: 'tier-locked',
  custom: 'badge-stopped'
}

const STATUS_CLASS: Record<SbxStatus, string> = {
  running: 'badge-running',
  stopped: 'badge-stopped',
  error: 'badge-error',
  unknown: 'badge-stopped'
}

export function TierBadge({ tier }: { tier: Tier | 'custom' }): JSX.Element {
  const t = useT()
  return <span className={`badge ${TIER_CLASS[tier]}`}>{t(`tier.${tier}`)}</span>
}

export function StatusBadge({ status }: { status: SbxStatus }): JSX.Element {
  const t = useT()
  return <span className={`badge ${STATUS_CLASS[status]}`}>{t(`status.${status}`)}</span>
}

/** Collapses the four raw auth states into the three buckets the badge displays. */
export function mcpAuthBucket(state: McpAuthState): 'authorized' | 'needs-auth' | 'na' {
  if (state === 'authorized') return 'authorized'
  if (state === 'unauthorized') return 'needs-auth'
  return 'na' // 'not-required' | 'unknown' — neither means the user must act
}

const MCP_AUTH_CLASS: Record<'authorized' | 'needs-auth' | 'na', string> = {
  authorized: 'badge-running',
  'needs-auth': 'tier-balanced',
  na: 'badge-stopped'
}

export function McpAuthBadge({ state }: { state: McpAuthState }): JSX.Element {
  const t = useT()
  const bucket = mcpAuthBucket(state)
  return <span className={`badge ${MCP_AUTH_CLASS[bucket]}`}>{t(`mcp.authBadge.${bucket}`)}</span>
}
