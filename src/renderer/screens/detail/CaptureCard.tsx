import type { CaptureCheck, CapturePhase, CaptureStatus } from '@shared/capture'
import { useT, type TFn } from '../../i18n'

const PHASE_KEYS: Record<CapturePhase, string> = {
  preflight: 'capture.phasePreflight',
  ca: 'capture.phaseCa',
  profile: 'capture.phaseProfile',
  tunnel: 'capture.phaseTunnel',
  verify: 'capture.phaseVerify'
}

const CHECK_KEYS: Record<string, string> = {
  burp: 'capture.checkBurp',
  ca: 'capture.checkCa',
  tunnel: 'capture.checkTunnel',
  concurrency: 'capture.checkConcurrency',
  credential: 'capture.checkCredential'
}

function CheckPill({ check, t }: { check: CaptureCheck; t: TFn }): JSX.Element {
  const label = CHECK_KEYS[check.id] ? t(CHECK_KEYS[check.id]) : check.id
  return (
    <span title={check.detail} style={{ fontSize: 12, color: check.ok ? 'var(--success, var(--accent))' : 'var(--danger)' }}>
      {check.ok ? '✓' : '✕'} {label} <span className="capture-check-detail">{check.detail}</span>
    </span>
  )
}

/**
 * Traffic-capture control for one sandbox, on the Monitoring tab — next to the traffic it
 * deepens. Purely presentational: `status` is global (only one session exists), so this
 * compares `status.sandbox` to its own `sandbox` to decide what it is looking at.
 */
export function CaptureCard({ status, sandbox, running, hasCa, onEnable, onDisable, onOpenShell }: {
  status: CaptureStatus
  sandbox: string
  running: boolean
  hasCa: boolean
  onEnable: (force: boolean) => void
  onDisable: () => void
  onOpenShell: () => void
}): JSX.Element {
  const t = useT()
  const mine = status.sandbox === sandbox
  const occupiedByOther = status.sandbox !== null && !mine
  const state = mine ? status.state : 'off'

  // Forcing past preflight is meaningless — a missing CA or absent socat is not a gate that
  // "enable anyway" can skip. Only the verify-phase credential gate is overridable.
  const canForce = mine && state === 'error' && status.phase === 'verify'

  let disabledReason: string | null = null
  if (!running) disabledReason = t('capture.needsRunning')
  else if (!hasCa) disabledReason = t('capture.needsCa')
  else if (occupiedByOther) disabledReason = t('capture.otherSandbox', { name: status.sandbox ?? '' })

  return (
    <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div className="card-title" style={{ flex: 1 }}>
          {t('capture.cardTitle')}
          <span style={{ marginLeft: 'var(--space-3)', fontWeight: 400, fontSize: 13, color: state === 'on' ? 'var(--success, var(--accent))' : 'var(--text-muted)' }}>
            {state === 'on' && `● ${t('capture.on')}`}
            {state === 'starting' && t('capture.starting')}
            {state === 'off' && t('capture.off')}
          </span>
        </div>
        {state === 'on'
          ? <button className="btn btn-secondary btn-sm" onClick={onDisable}>{t('capture.disable')}</button>
          : (
            <button className="btn btn-primary btn-sm" disabled={disabledReason !== null || state === 'starting'} onClick={() => onEnable(false)}>
              {t('capture.enable')}
            </button>
          )}
      </div>

      {disabledReason && <p className="section-desc" style={{ fontSize: 12, marginBottom: 0 }}>{disabledReason}</p>}

      {mine && state === 'starting' && status.phase && (
        <p className="section-desc" style={{ fontSize: 12, marginBottom: 0 }}>{t(PHASE_KEYS[status.phase])}</p>
      )}

      {mine && state === 'on' && status.ports && (
        <p className="section-desc" style={{ fontSize: 12, marginBottom: 'var(--space-2)' }}>
          {t('capture.ports', { proxy: status.ports.proxy, upstream: status.ports.upstream })}
        </p>
      )}

      {mine && status.checks.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          {status.checks.map((c) => <CheckPill key={c.id} check={c} t={t} />)}
        </div>
      )}

      {mine && state === 'error' && status.message && (
        <div role="alert" style={{ marginTop: 'var(--space-2)' }}>
          <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{status.message}</p>
          {canForce && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--space-2)' }} onClick={() => onEnable(true)}>
              {t('capture.enableAnyway')}
            </button>
          )}
        </div>
      )}

      {mine && state === 'on' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <span style={{ fontSize: 12 }}>⚠ {t('capture.agentNotCaptured')}</span>
          <button className="btn btn-ghost btn-sm" onClick={onOpenShell}>{t('capture.openShell')}</button>
        </div>
      )}
    </div>
  )
}
