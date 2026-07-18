import type { SbxStatus, Tier } from '@shared/types'

const TIER_META: Record<Tier | 'custom', { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'tier-open' },
  balanced: { label: 'Balanced', cls: 'tier-balanced' },
  locked: { label: 'Locked Down', cls: 'tier-locked' },
  custom: { label: 'Custom', cls: 'badge-stopped' }
}

const STATUS_META: Record<SbxStatus, { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'badge-running' },
  stopped: { label: 'Stopped', cls: 'badge-stopped' },
  error: { label: 'Error', cls: 'badge-error' },
  unknown: { label: 'Unknown', cls: 'badge-stopped' }
}

export function TierBadge({ tier }: { tier: Tier | 'custom' }): JSX.Element {
  const m = TIER_META[tier]
  return <span className={`badge ${m.cls}`}>{m.label}</span>
}

export function StatusBadge({ status }: { status: SbxStatus }): JSX.Element {
  const m = STATUS_META[status]
  return <span className={`badge ${m.cls}`}>{m.label}</span>
}
