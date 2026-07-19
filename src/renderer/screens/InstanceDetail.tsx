import { useEffect, useState } from 'react'
import type { InstanceView, DefinitionSpec } from '@shared/types'
import { StatusBadge } from '../components/badges'
import { api } from '../ipc/client'
import { useT } from '../i18n'
import { TerminalsTab } from './detail/TerminalsTab'

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

  useEffect(() => {
    let alive = true
    if (!instance.definitionId) { setSpec(null); return }
    void api.defGetSpec(instance.definitionId).then((r) => { if (alive && r.ok) setSpec(r.data) })
    return () => { alive = false }
  }, [instance.definitionId])

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
        <button role="tab" aria-selected={tab === 'monitoring'} style={tabStyle(tab === 'monitoring')} onClick={() => setTab('monitoring')}>{t('detail.tabMonitoring')}</button>
      </div>

      {tab === 'terminals' && <TerminalsTab instance={instance} spec={spec} onAttach={onAttach} onShell={onShell} />}
      {tab === 'ports' && <p className="section-desc">Ports —</p>}
      {tab === 'monitoring' && <p className="section-desc">Monitoring —</p>}
    </section>
  )
}
