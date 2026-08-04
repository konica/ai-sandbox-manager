import { useCallback, useEffect, useState } from 'react'
import type { InstanceView, DefinitionSpec, LivePort, PolicySummary } from '@shared/types'
import { StatusBadge } from '../components/badges'
import { api } from '../ipc/client'
import { useT } from '../i18n'
import { TerminalsTab } from './detail/TerminalsTab'
import { PortsTab } from './detail/PortsTab'
import { MonitoringTab } from './detail/MonitoringTab'

export type DetailTab = 'terminals' | 'ports' | 'monitoring'

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: 'var(--space-2) var(--space-3)', fontSize: 13, fontWeight: 510, border: 'none',
    background: 'none', cursor: 'pointer', fontFamily: 'inherit',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    color: active ? 'var(--accent)' : 'var(--text-muted)'
  }
}

/**
 * Sandbox instance detail — a drill-in from the Instances list. Header + three tabs
 * (Terminals / Ports / Monitoring). Terminals use the native Terminal.app launch IPC;
 * the definition spec (fetched here) feeds the Terminals info sidebar and the Ports
 * host-services list.
 */
export function InstanceDetail({ instance, hasVSCode = false, onBack, onStop, onRemove, onRebuild, onApplyCredentials, onAttach, onShell }: {
  instance: InstanceView
  hasVSCode?: boolean
  onBack: () => void
  onStop: (name: string) => void
  onRemove: (name: string) => void
  onRebuild: (name: string) => void
  onApplyCredentials: (name: string) => void
  onAttach: (name: string, opener: 'terminal' | 'vscode') => void
  onShell: (name: string) => void
}): JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<DetailTab>('terminals')
  const [spec, setSpec] = useState<DefinitionSpec | null>(null)
  const [livePorts, setLivePorts] = useState<LivePort[]>([])
  const [policy, setPolicy] = useState<PolicySummary>({ allowed: 0, blocked: 0, events: [] })
  // Optimistic per-host state after an Allow/Deny click — sbx keeps the historical log
  // row until a new request re-classifies it, so we reflect the intent immediately.
  const [override, setOverride] = useState<Record<string, 'allow' | 'deny'>>({})
  const [commands, setCommands] = useState<{ agent: string; shell: string } | null>(null)

  const reloadSpec = useCallback(async () => {
    if (!instance.definitionId) { setSpec(null); return }
    const r = await api.defGetSpec(instance.definitionId)
    if (r.ok) setSpec(r.data)
  }, [instance.definitionId])
  const reloadPorts = useCallback(async () => {
    const r = await api.instancePortsList(instance.name)
    if (r.ok) setLivePorts(r.data)
  }, [instance.name])
  const reloadPolicy = useCallback(async () => {
    const r = await api.instancePolicyLog(instance.name)
    if (r.ok) setPolicy(r.data)
  }, [instance.name])

  useEffect(() => { void reloadSpec() }, [reloadSpec])
  useEffect(() => { void api.instanceCommands(instance.name).then((r) => { if (r.ok) setCommands(r.data) }) }, [instance.name])
  useEffect(() => { if (tab === 'ports') void reloadPorts() }, [tab, reloadPorts])
  // Poll the policy log while the Monitoring tab is open (sbx policy log has no stream).
  useEffect(() => {
    if (tab !== 'monitoring') return
    void reloadPolicy()
    const id = setInterval(() => void reloadPolicy(), 5000)
    return () => clearInterval(id)
  }, [tab, reloadPolicy])

  const running = instance.status === 'running'

  // One row per host (most recent), with any optimistic Allow/Deny applied.
  const seenHosts = new Set<string>()
  const trafficEvents = policy.events
    .map((e) => { const o = override[e.host]; return o ? { ...e, allowed: o === 'allow' } : e })
    .filter((e) => { if (seenHosts.has(e.host)) return false; seenHosts.add(e.host); return true })
  const blockedHosts = trafficEvents.filter((e) => !e.allowed).length

  function setHostOverride(host: string, state: 'allow' | 'deny'): void {
    setOverride((prev) => ({ ...prev, [host]: state }))
  }

  return (
    <section className="screen active">
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 'var(--space-3)' }}>← {t('detail.back')}</button>

      <div className="detail-header">
        <h2>{instance.name}</h2>
        <StatusBadge status={instance.status} />
        {instance.workspace && <span className="detail-meta">{instance.workspace}</span>}
        <span className="detail-meta" style={{ marginLeft: 0 }}>{instance.agent}</span>
        {instance.definitionName && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'var(--space-2)' }}>
            {t('detail.fromDefinition')} <span style={{ color: 'var(--accent)' }}>{instance.definitionName}</span>
          </span>
        )}
        <div className="detail-actions">
          <button className="btn btn-secondary btn-sm" disabled={!running} onClick={() => onStop(instance.name)}>■ {t('detail.stop')}</button>
          <button className="btn btn-secondary btn-sm" title={t('detail.rebuildHint')} onClick={() => onRebuild(instance.name)}>↻ {t('detail.rebuild')}</button>
          <button className="btn btn-destructive btn-sm" onClick={() => onRemove(instance.name)}>✕ {t('detail.remove')}</button>
        </div>
      </div>

      {instance.credsDrift && (
        <div role="status" className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--warning, var(--accent))' }}>
          <span style={{ fontSize: 13, flex: 1 }}>{t('detail.credsDriftNotice')}</span>
          <button className="btn btn-primary btn-sm" title={t('detail.applyLiveHint')} onClick={() => onApplyCredentials(instance.name)}>{t('detail.applyLive')}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onRebuild(instance.name)}>↻ {t('detail.rebuild')}</button>
        </div>
      )}

      <div role="tablist" className="tabs detail-tabs" style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--border)', marginBottom: 'var(--space-5)' }}>
        <button role="tab" aria-selected={tab === 'terminals'} style={tabStyle(tab === 'terminals')} onClick={() => setTab('terminals')}>{t('detail.tabTerminals')}</button>
        <button role="tab" aria-selected={tab === 'ports'} style={tabStyle(tab === 'ports')} onClick={() => setTab('ports')}>{t('detail.tabPorts')}</button>
        <button role="tab" aria-selected={tab === 'monitoring'} style={tabStyle(tab === 'monitoring')} onClick={() => setTab('monitoring')}>
          {t('detail.tabMonitoring')}
          {blockedHosts > 0 && (
            <span
              title={t('detail.blockedDomainsHint')}
              style={{
                marginLeft: 'var(--space-2)', background: 'var(--danger)', color: '#fff',
                fontSize: 11, fontWeight: 700, lineHeight: 1, padding: '3px 7px', borderRadius: 999,
                minWidth: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle'
              }}
            >{blockedHosts}</span>
          )}
        </button>
      </div>

      {tab === 'terminals' && (
        <TerminalsTab
          instance={instance}
          spec={spec}
          hasVSCode={hasVSCode}
          agentCommand={commands?.agent}
          shellCommand={commands?.shell}
          onAttach={onAttach}
          onShell={onShell}
          onAllowDomain={async (d) => { await api.instanceDomainAllow(instance.name, d); void reloadSpec() }}
          onDenyDomain={async (d) => { await api.instanceDomainDeny(instance.name, d); void reloadSpec() }}
        />
      )}
      {tab === 'ports' && (
        <PortsTab
          instance={instance}
          ports={livePorts}
          hostServices={spec?.hostServices ?? []}
          linked={instance.definitionId !== null}
          onPublish={async (p) => { await api.instancePortsPublish(instance.name, p); void reloadPorts() }}
          onUnpublish={async (p) => { await api.instancePortsUnpublish(instance.name, p); void reloadPorts() }}
          onAddHostService={async (port, label) => { await api.instanceHostServiceAdd(instance.name, port, label); void reloadSpec() }}
          onRemoveHostService={async (port) => { await api.instanceHostServiceRemove(instance.name, port); void reloadSpec() }}
        />
      )}
      {tab === 'monitoring' && (
        <MonitoringTab
          summary={{ allowed: policy.allowed, blocked: policy.blocked, events: trafficEvents }}
          onAllow={async (host) => {
            setHostOverride(host, 'allow') // reflect immediately (log keeps the stale row until next request)
            await api.instanceDomainAllow(instance.name, host)
            void reloadPolicy(); void reloadSpec() // reloadSpec → the definition change shows in the Network Policy card
          }}
          onDeny={async (host) => {
            setHostOverride(host, 'deny')
            await api.instanceDomainDeny(instance.name, host)
            void reloadPolicy(); void reloadSpec()
          }}
        />
      )}
    </section>
  )
}
