import type { PrereqResult } from '@shared/types'

export function Prereq({
  result,
  onRecheck,
  onContinue
}: {
  result: PrereqResult
  onRecheck: () => void
  onContinue?: () => void
}): JSX.Element {
  return (
    <section className="screen active">
      <div className="prereq-card card">
        <h2 className="section-title">System Prerequisites</h2>
        <p className="section-desc">Checking your environment for Docker Sandboxes support. Some items may require manual setup.</p>

        {result.checks.map((c) => (
          <div key={c.id} className={`check-item ${c.ok ? 'check-pass' : 'check-fail'}`}>
            <div className="check-icon">{c.ok ? '✓' : '✕'}</div>
            <div>
              <div className="check-label">{c.label}</div>
              <div className="check-detail">
                {c.detail}
                {!c.ok && c.remediation ? ` — ${c.remediation}` : ''}
              </div>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
          <button className="btn btn-primary" onClick={onRecheck}>Retry All Checks</button>
          {onContinue && <button className="btn btn-secondary" onClick={onContinue}>Continue Anyway</button>}
        </div>
      </div>
    </section>
  )
}
