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
export function InstanceDetail({ instance, onBack, onStop, onRemove, onAttach, onShell }: {
  instance: InstanceView
  onBack: () => void
  onStop: (name: string) => void
  onRemove: (name: string) => void
  onAttach: (name: string) => void
  onShell: (name: string) => void
}): JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<DetailTab>('terminals')
  const [spec, setSpec] = useState<DefinitionSpec | null>(null)
  const [livePorts, setLivePorts] = useState<LivePort[]>([])
  const [policy, setPolicy] = useState<PolicySummary>({ allowed: 0, blocked: 0, events: [] })
  // Hosts allowed this session — suppress their stale blocked rows immediately, since
  // sbx keeps the historical blocked entry until a new request re-classifies it.
  const [justAllowed, setJustAllowed] = useState<Set<string>>(new Set())

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
  useEffect(() => { if (tab === 'ports') void reloadPorts() }, [tab, reloadPorts])
  // Poll the policy log while the Monitoring tab is open (sbx policy log has no stream).
  useEffect(() => {
    if (tab !== 'monitoring') return
    void reloadPolicy()
    const id = setInterval(() => void reloadPolicy(), 5000)
    return () => clearInterval(id)
  }, [tab, reloadPolicy])

  const running = instance.status === 'running'

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
          <button className="btn btn-destructive btn-sm" onClick={() => onRemove(instance.name)}>✕ {t('detail.remove')}</button>
        </div>
      </div>

      <div role="tablist" className="tabs detail-tabs" style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--border)', marginBottom: 'var(--space-5)' }}>
        <button role="tab" aria-selected={tab === 'terminals'} style={tabStyle(tab === 'terminals')} onClick={() => setTab('terminals')}>{t('detail.tabTerminals')}</button>
        <button role="tab" aria-selected={tab === 'ports'} style={tabStyle(tab === 'ports')} onClick={() => setTab('ports')}>{t('detail.tabPorts')}</button>
        <button role="tab" aria-selected={tab === 'monitoring'} style={tabStyle(tab === 'monitoring')} onClick={() => setTab('monitoring')}>
          {t('detail.tabMonitoring')}
          {policy.blocked > 0 && <span className="nav-badge" style={{ marginLeft: 'var(--space-1)', fontSize: 10, background: 'var(--danger)' }}>{policy.blocked}</span>}
        </button>
      </div>

      {tab === 'terminals' && (
        <TerminalsTab
          instance={instance}
          spec={spec}
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
          summary={{
            allowed: policy.allowed,
            blocked: policy.events.filter((e) => !e.allowed && !justAllowed.has(e.host)).length,
            events: policy.events.filter((e) => !(justAllowed.has(e.host) && !e.allowed))
          }}
          onAllow={async (host) => {
            setJustAllowed((prev) => new Set(prev).add(host)) // hide the stale blocked row immediately
            await api.instanceDomainAllow(instance.name, host)
            void reloadPolicy()
          }}
        />
      )}
    </section>
  )
}
