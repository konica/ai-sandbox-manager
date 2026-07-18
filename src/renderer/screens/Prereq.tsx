import type { PrereqResult } from '@shared/types'
import { useT } from '../i18n'

export function Prereq({
  result,
  onRecheck,
  onContinue
}: {
  result: PrereqResult
  onRecheck: () => void
  onContinue?: () => void
}): JSX.Element {
  const t = useT()
  return (
    <section className="screen active">
      <div className="prereq-card card">
        <h2 className="section-title">{t('prereq.title')}</h2>
        <p className="section-desc">{t('prereq.subtitle')}</p>

        {result.checks.map((c) => {
          const detail = t(`prereq.${c.id}.${c.ok ? 'ok' : 'fail'}`, { value: c.value ?? '', gib: c.freeGiB ?? '' })
          const fixKey = `prereq.${c.id}.fix`
          const fix = t(fixKey)
          const hasFix = !c.ok && fix !== fixKey
          return (
            <div key={c.id} className={`check-item ${c.ok ? 'check-pass' : 'check-fail'}`}>
              <div className="check-icon">{c.ok ? '✓' : '✕'}</div>
              <div>
                <div className="check-label">{t(`prereq.${c.id}.label`)}</div>
                <div className="check-detail">{detail}{hasFix ? ` — ${fix}` : ''}</div>
              </div>
            </div>
          )
        })}

        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
          <button className="btn btn-primary" onClick={onRecheck}>{t('prereq.retry')}</button>
          {onContinue && <button className="btn btn-secondary" onClick={onContinue}>{t('prereq.continueAnyway')}</button>}
        </div>
      </div>
    </section>
  )
}
