import type { PolicySummary } from '@shared/types'
import { useT } from '../../i18n'

/**
 * Monitoring tab: allowed/blocked request counters + a live traffic log from
 * `sbx policy log`. Each blocked row offers a live **Allow** action (dual-written to
 * the definition), so you can unblock a domain the sandbox just tried to reach.
 */
export function MonitoringTab({ summary, onAllow }: {
  summary: PolicySummary
  onAllow: (host: string) => void
}): JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="mon-summary" style={{ display: 'flex', gap: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
        <div className="mon-stat"><span className="mon-stat-value allowed">{summary.allowed}</span><span className="mon-stat-label">{t('detail.allowedRequests')}</span></div>
        <div className="mon-stat"><span className="mon-stat-value blocked">{summary.blocked}</span><span className="mon-stat-label">{t('detail.blockedRequests')}</span></div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">{t('detail.liveTraffic')}</div></div>
        {summary.events.length === 0
          ? <p className="section-desc" style={{ fontSize: 12 }}>{t('detail.noTraffic')}</p>
          : (
            <table className="traffic-table" style={{ width: '100%' }}>
              <tbody>
                {summary.events.map((e, i) => (
                  <tr key={i}>
                    <td style={{ width: 20 }} className={e.allowed ? 'traffic-allowed' : 'traffic-blocked'}>{e.allowed ? '✓' : '✕'}</td>
                    <td className="traffic-domain">{e.host}</td>
                    <td className="traffic-rule" style={{ color: 'var(--text-muted)', fontSize: 11 }}>{e.reason}</td>
                    <td style={{ textAlign: 'right' }}>
                      {!e.allowed && <button className="btn btn-ghost btn-sm" onClick={() => onAllow(e.host)}>{t('detail.allow')}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}
