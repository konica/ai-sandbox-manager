import type { PolicySummary } from '@shared/types'
import { useT } from '../../i18n'

function fmtTime(at: string): string {
  if (!at) return ''
  const d = new Date(at)
  return isNaN(d.getTime()) ? at : d.toLocaleTimeString([], { hour12: false })
}

/**
 * Monitoring tab: allowed/blocked request counters + a live traffic log from
 * `sbx policy log`. Each row shows the time and a live toggle — blocked hosts get
 * **Allow** (open), allowed hosts get **Deny** (close). Both dual-write to the definition.
 */
export function MonitoringTab({ summary, onAllow, onDeny }: {
  summary: PolicySummary
  onAllow: (host: string) => void
  onDeny: (host: string) => void
}): JSX.Element {
  const t = useT()
  const blockedDomains = summary.events.filter((e) => !e.allowed).length
  return (
    <div>
      <div className="mon-summary" style={{ display: 'flex', gap: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
        <div className="mon-stat"><span className="mon-stat-value allowed">{summary.allowed}</span><span className="mon-stat-label">{t('detail.allowedRequests')}</span></div>
        <div className="mon-stat"><span className="mon-stat-value blocked">{summary.blocked}</span><span className="mon-stat-label">{t('detail.blockedRequests')}</span></div>
        <div className="mon-stat" title={t('detail.blockedDomainsHint')}><span className="mon-stat-value blocked">{blockedDomains}</span><span className="mon-stat-label">{t('detail.blockedDomains')}</span></div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">{t('detail.liveTraffic')}</div></div>
        {summary.events.length === 0
          ? <p className="section-desc" style={{ fontSize: 12 }}>{t('detail.noTraffic')}</p>
          : (
            <table className="traffic-table" style={{ width: '100%' }}>
              <thead>
                <tr style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  <th style={{ width: 20 }}></th>
                  <th style={{ textAlign: 'left', fontWeight: 600 }}>{t('detail.colTime')}</th>
                  <th style={{ textAlign: 'left', fontWeight: 600 }}>{t('detail.colHost')}</th>
                  <th style={{ textAlign: 'left', fontWeight: 600 }}>{t('detail.colReason')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {summary.events.map((e, i) => (
                  <tr key={i}>
                    <td style={{ width: 20 }} className={e.allowed ? 'traffic-allowed' : 'traffic-blocked'}>{e.allowed ? '✓' : '✕'}</td>
                    <td className="traffic-time" style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' }}>{fmtTime(e.at)}</td>
                    <td className="traffic-domain">{e.host}</td>
                    <td className="traffic-rule" style={{ color: 'var(--text-muted)', fontSize: 11 }}>{e.reason}</td>
                    <td style={{ textAlign: 'right' }}>
                      {e.allowed
                        ? <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => onDeny(e.host)}>{t('detail.deny')}</button>
                        : <button className="btn btn-ghost btn-sm" onClick={() => onAllow(e.host)}>{t('detail.allow')}</button>}
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
