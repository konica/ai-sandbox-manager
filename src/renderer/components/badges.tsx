import type { SbxStatus, Tier } from '@shared/types'
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
