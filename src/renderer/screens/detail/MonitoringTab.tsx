import type { PolicySummary } from '@shared/types'
import { useT } from '../../i18n'
import { PROXY_TYPES, proxyTone, proxyLabelKey, proxyMeaningKey } from '@shared/proxy-types'
import { formatBytes } from '@shared/format-bytes'
import type { ResourceStats } from '@shared/resource-stats'

function fmtTime(at: string): string {
  if (!at) return ''
  const d = new Date(at)
  return isNaN(d.getTime()) ? at : d.toLocaleTimeString([], { hour12: false })
}

/** A proxy-type pill: friendly label + tone color + meaning tooltip. Empty type → nothing. */
function ProxyBadge({ type }: { type: string }): JSX.Element | null {
  const t = useT()
  if (!type) return null
  const labelKey = proxyLabelKey(type)
  const meaningKey = proxyMeaningKey(type)
  return (
    <span className={`proxy-badge ${proxyTone(type)}`} title={meaningKey ? t(meaningKey) : t('detail.proxyUnknownMeaning')}>
      {labelKey ? t(labelKey) : type}
    </span>
  )
}

export type ResourceStatsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ResourceStats; at: string }

/**
 * Monitoring tab: allowed/blocked request counters + a live traffic log from
 * `sbx policy log`. Each row shows the time and a live toggle — blocked hosts get
 * **Allow** (open), allowed hosts get **Deny** (close). Both dual-write to the definition.
 * The Resource usage card is on-demand — the sandbox has no push metrics, so the
 * Fetch/Refresh button probes it via `instance:stats` rather than polling continuously.
 */
export function MonitoringTab({ summary, onAllow, onDeny, stats, running, onFetchStats }: {
  summary: PolicySummary
  onAllow: (host: string) => void
  onDeny: (host: string) => void
  stats: ResourceStatsState
  running: boolean
  onFetchStats: () => void
}): JSX.Element {
  const t = useT()
  // Counts are over distinct domains (one row per host) so they map to the list, the
  // Allow/Deny actions, and the Monitoring tab badge — not cumulative request totals.
  const allowedList = summary.events.filter((e) => e.allowed).sort((a, b) => b.count - a.count)
  const blockedList = summary.events.filter((e) => !e.allowed).sort((a, b) => b.count - a.count)
  const allowedDomains = allowedList.length
  const blockedDomains = blockedList.length
  return (
    <div>
      <ResourceCard stats={stats} running={running} onFetch={onFetchStats} t={t} />

      <div className="mon-summary" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
        <div className="mon-stat"><span className="mon-stat-value allowed">{summary.allowed}</span><span className="mon-stat-label">{t('detail.allowedRequests')}</span></div>
        <div className="mon-stat"><span className="mon-stat-value blocked">{summary.blocked}</span><span className="mon-stat-label">{t('detail.blockedRequests')}</span></div>
        <div className="mon-stat"><span className="mon-stat-value allowed">{allowedDomains}</span><span className="mon-stat-label">{t('detail.allowedDomains')}</span></div>
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
                  <th style={{ textAlign: 'left', fontWeight: 600 }}>{t('detail.colProxy')}</th>
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
                    <td><ProxyBadge type={e.proxyType} /></td>
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

      {summary.events.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--space-5)' }}>
          <div className="card-header"><div className="card-title">{t('detail.domainRequests')}</div></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>
            <DomainGroup label={t('detail.allowedDomains')} rows={allowedList} allowed onAct={onDeny} actLabel={t('detail.deny')} t={t} />
            <DomainGroup label={t('detail.blockedDomains')} rows={blockedList} allowed={false} onAct={onAllow} actLabel={t('detail.allow')} t={t} />
          </div>
        </div>
      )}

      <details className="proxy-legend">
        <summary>{t('detail.proxyLegendTitle')}</summary>
        <div className="proxy-legend-body">
          {PROXY_TYPES.map((p) => (
            <div key={p} className="proxy-legend-row">
              <ProxyBadge type={p} />
              <span className="section-desc" style={{ fontSize: 12, margin: 0 }}>{t(proxyMeaningKey(p) as string)}</span>
            </div>
          ))}
          <a href="https://docs.docker.com/ai/sandboxes/governance/monitoring/#monitoring-traffic" target="_blank" rel="noreferrer">{t('detail.proxyLegendLearnMore')} →</a>
        </div>
      </details>
    </div>
  )
}

function DomainGroup({ label, rows, allowed, onAct, actLabel, t }: {
  label: string
  rows: { host: string; count: number; proxyType: string }[]
  allowed: boolean
  onAct: (host: string) => void
  actLabel: string
  t: (k: string) => string
}): JSX.Element {
  return (
    <div>
      <div className="cred-type-label" role="heading" aria-level={4} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{label}</span><span>{rows.length}</span></div>
      {rows.length === 0
        ? <p className="section-desc" style={{ fontSize: 12, margin: 0 }}>—</p>
        : rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
            <span className={allowed ? 'traffic-allowed' : 'traffic-blocked'} style={{ width: 12 }}>{allowed ? '✓' : '✕'}</span>
            <span style={{ flex: '1 1 auto', fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.host}>{r.host}</span>
            <ProxyBadge type={r.proxyType} />
            <span title={t('detail.requestsTooltip')} style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{r.count}</span>
            <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0, ...(allowed ? { color: 'var(--danger)' } : {}) }} onClick={() => onAct(r.host)}>{actLabel}</button>
          </div>
        ))}
    </div>
  )
}

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0
}

function ResourceCard({ stats, running, onFetch, t }: {
  stats: ResourceStatsState
  running: boolean
  onFetch: () => void
  t: (k: string, vars?: Record<string, string | number>) => string
}): JSX.Element {
  const btnLabel = stats.status === 'loading' ? t('detail.statsFetching')
    : stats.status === 'ready' ? t('detail.refreshStats') : t('detail.fetchStats')
  return (
    <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="card-title">{t('detail.resourceUsage')}</div>
        <button className="btn btn-secondary btn-sm" disabled={!running || stats.status === 'loading'} onClick={onFetch}>{btnLabel}</button>
      </div>
      {!running && <p className="section-desc" style={{ fontSize: 12, marginTop: 0 }}>{t('detail.statsRunningHint')}</p>}
      {stats.status === 'error' && <p className="section-desc" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 0 }}>{t('detail.statsError', { message: stats.message })}</p>}
      {stats.status === 'ready' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', marginTop: 'var(--space-2)' }}>
            <Tile label={t('detail.statCpu')} value={stats.data.cpu ? `${stats.data.cpu.cores.toFixed(2)} cores` : t('detail.statUnavailable')}
              title={stats.data.cpu ? t('detail.cpuOfCpus', { pct: Math.round((stats.data.cpu.cores / stats.data.cpu.ofCpus) * 100), n: stats.data.cpu.ofCpus }) : undefined} />
            <Tile label={t('detail.statMemory')} value={stats.data.memory
              ? (stats.data.memory.limitBytes !== null
                  ? `${formatBytes(stats.data.memory.usedBytes)} / ${formatBytes(stats.data.memory.limitBytes)} (${pct(stats.data.memory.usedBytes, stats.data.memory.limitBytes)}%)`
                  : `${formatBytes(stats.data.memory.usedBytes)} · ${t('detail.memNoLimit')}`)
              : t('detail.statUnavailable')} />
            <Tile label={t('detail.statDisk')} value={stats.data.disk
              ? `${formatBytes(stats.data.disk.usedBytes)} / ${formatBytes(stats.data.disk.totalBytes)} (${pct(stats.data.disk.usedBytes, stats.data.disk.totalBytes)}%)`
              : t('detail.statUnavailable')} />
          </div>
          <p className="section-desc" style={{ fontSize: 11, marginTop: 'var(--space-2)', marginBottom: 0 }}>{t('detail.statsAsOf', { time: new Date(stats.at).toLocaleTimeString() })}</p>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, title }: { label: string; value: string; title?: string }): JSX.Element {
  return (
    <div className="mon-stat" title={title}>
      <span className="mon-stat-value" style={{ fontSize: 15 }}>{value}</span>
      <span className="mon-stat-label">{label}</span>
    </div>
  )
}
