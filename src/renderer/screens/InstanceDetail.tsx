import { useCallback, useEffect, useState } from 'react'
import type { InstanceView, DefinitionSpec, LivePort, PolicySummary } from '@shared/types'
import { StatusBadge } from '../components/badges'
import { api } from '../ipc/client'
import { useT } from '../i18n'
import { TerminalsTab } from './detail/TerminalsTab'
import { SessionBackups } from './detail/SessionBackups'
import { PortsTab } from './detail/PortsTab'
import { MonitoringTab, type ResourceStatsState } from './detail/MonitoringTab'
import { CaptureCard } from './detail/CaptureCard'
import { IDLE_STATUS, type CaptureStatus } from '@shared/capture'
import { MetadataTab } from './detail/MetadataTab'
import { FilesTab } from './detail/FilesTab'

export type DetailTab = 'terminals' | 'files' | 'ports' | 'monitoring' | 'metadata'

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: 'var(--space-2) var(--space-3)', fontSize: 13, fontWeight: 510, border: 'none',
    background: 'none', cursor: 'pointer', fontFamily: 'inherit',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    color: active ? 'var(--accent)' : 'var(--text-muted)'
  }
}

/**
 * Sandbox instance detail — a drill-in from the Instances list. Header + four tabs
 * (Terminals / Ports / Monitoring / Metadata). Terminals use the native Terminal.app launch IPC;
 * the definition spec (fetched here) feeds the Terminals info sidebar and the Ports
 * host-services list. Metadata holds per-instance tags for organization and filtering.
 */
export function InstanceDetail({ instance, hasVSCode = false, onBack, onStop, onRemove, onRebuild, onApplyCredentials, onAttach, onShell, onSetTags }: {
  instance: InstanceView
  hasVSCode?: boolean
  onBack: () => void
  onStop: (name: string) => void
  onRemove: (name: string) => void
  onRebuild: (name: string) => void
  onApplyCredentials: (name: string) => void
  onAttach: (name: string, opener: 'terminal' | 'vscode') => void
  onShell: (name: string) => void
  onSetTags: (name: string, tags: string[]) => void
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
  const [tags, setTags] = useState<string[]>(instance.tags)
  const [stats, setStats] = useState<ResourceStatsState>({ status: 'idle' })
  const [hostDir, setHostDir] = useState('')
  const [sandboxDir, setSandboxDir] = useState('')
  useEffect(() => {
    void api.prefsGet('copyDefaultHostDir').then((r) => { if (r.ok && r.data) setHostDir(r.data) })
    void api.prefsGet('copyDefaultSandboxDir').then((r) => { if (r.ok && r.data) setSandboxDir(r.data) })
  }, [])
  const saveHostDir = useCallback((v: string) => { setHostDir(v); void api.prefsSet('copyDefaultHostDir', v) }, [])
  const saveSandboxDir = useCallback((v: string) => { setSandboxDir(v); void api.prefsSet('copyDefaultSandboxDir', v) }, [])
  useEffect(() => { setStats({ status: 'idle' }) }, [instance.name])
  useEffect(() => {
    setTags((prev) => {
      const next = instance.tags
      return prev.length === next.length && prev.every((t, i) => t === next[i]) ? prev : next
    })
  }, [instance.name, instance.tags])

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
  // Capture status is global (only one session may exist), so it is not keyed by instance.
  const [capture, setCapture] = useState<CaptureStatus>(IDLE_STATUS)
  const [hasCa, setHasCa] = useState(false)
  useEffect(() => { void api.captureSettingsGet().then((r) => { if (r.ok) setHasCa(r.data.caPath.trim().length > 0) }) }, [])
  const reloadCapture = useCallback(async () => {
    const r = await api.captureStatus()
    if (r.ok) setCapture(r.data)
  }, [])

  // The shell command embeds the capture port, so it MUST be re-fetched whenever capture
  // starts or stops for THIS instance. Keying the fetch on the name alone froze the command
  // at whatever it was when the instance was opened, so the copyable command kept its
  // pre-capture form and any shell opened from it silently bypassed Burp. 0 means "not
  // captured", which is also the right key when another sandbox holds the session.
  const capturePort = capture.state === 'on' && capture.sandbox === instance.name ? capture.ports?.app ?? 0 : 0

  useEffect(() => { void reloadSpec() }, [reloadSpec])
  useEffect(() => { void api.instanceCommands(instance.name).then((r) => { if (r.ok) setCommands(r.data) }) }, [instance.name, capturePort])
  useEffect(() => { if (tab === 'ports') void reloadPorts() }, [tab, reloadPorts])
  // Poll the policy log while the Monitoring tab is open (sbx policy log has no stream).
  useEffect(() => {
    if (tab !== 'monitoring') return
    void reloadPolicy()
    const id = setInterval(() => void reloadPolicy(), 5000)
    return () => clearInterval(id)
  }, [tab, reloadPolicy])
  // Polled rather than pushed, on the same interval as the policy log — but deliberately NOT
  // gated on the Monitoring tab. The toggle lives on Monitoring while the command that embeds
  // the capture port is copied from Terminals, so gating this left that command stale on the
  // very tab the user copies it from. `capture:status` is an in-memory read in main with no
  // subprocess behind it, so polling it from any tab is cheap.
  useEffect(() => {
    void reloadCapture()
    const id = setInterval(() => void reloadCapture(), 5000)
    return () => clearInterval(id)
  }, [reloadCapture])

  const running = instance.status === 'running'
  // "Apply live" is actionable whenever a running instance is linked to a definition that has
  // service/custom credentials — not only on detected drift. Instances linked by workspace path
  // (no instance_meta baseline) can't surface drift, so a drift-only gate would hide the action
  // from them entirely. The drift banner below shows its own prominent button, so hide this
  // header one when drift is flagged to avoid a duplicate.
  const hasApplicableCreds = (spec?.credentials ?? []).some((c) => c.kind === 'service' || c.kind === 'custom')
  const showHeaderApplyLive = running && instance.definitionId != null && hasApplicableCreds && !instance.credsDrift

  // One row per host (most recent), with any optimistic Allow/Deny applied.
  const seenHosts = new Set<string>()
  const trafficEvents = policy.events
    .map((e) => { const o = override[e.host]; return o ? { ...e, allowed: o === 'allow' } : e })
    .filter((e) => { if (seenHosts.has(e.host)) return false; seenHosts.add(e.host); return true })
  const blockedHosts = trafficEvents.filter((e) => !e.allowed).length

  function setHostOverride(host: string, state: 'allow' | 'deny'): void {
    setOverride((prev) => ({ ...prev, [host]: state }))
  }

  const onFetchStats = useCallback(async (): Promise<void> => {
    setStats({ status: 'loading' })
    const r = await api.instanceStats(instance.name)
    if (r.ok) setStats({ status: 'ready', data: r.data, at: new Date().toISOString() })
    else setStats({ status: 'error', message: r.error.message })
  }, [instance.name])

  // Auto-fetch resource usage once when the Monitoring tab opens for a running instance.
  // Gated on 'idle' so it fires exactly once per instance (the status advances to loading →
  // ready/error and stays there); switching instances resets stats to idle (effect above),
  // re-arming this. Not polling — the Refresh button covers manual updates. See MonitoringTab.
  useEffect(() => {
    if (tab === 'monitoring' && running && stats.status === 'idle') void onFetchStats()
  }, [tab, running, stats.status, onFetchStats])

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
          {showHeaderApplyLive && (
            <button className="btn btn-secondary btn-sm" title={t('detail.applyLiveHint')} onClick={() => onApplyCredentials(instance.name)}>{t('detail.applyLive')}</button>
          )}
          <button className="btn btn-secondary btn-sm" title={t('detail.rebuildHint')} onClick={() => onRebuild(instance.name)}>↻ {t('detail.rebuild')}</button>
          <button className="btn btn-destructive btn-sm" onClick={() => onRemove(instance.name)}>✕ {t('detail.remove')}</button>
        </div>
      </div>

      {instance.credsDrift && (
        <div role="status" className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--warning, var(--accent))' }}>
          <span style={{ fontSize: 13, flex: 1 }}>{t('detail.credsDriftNotice')}</span>
          <button className="btn btn-primary btn-sm" disabled={!running} title={t('detail.applyLiveHint')} onClick={() => onApplyCredentials(instance.name)}>{t('detail.applyLive')}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onRebuild(instance.name)}>↻ {t('detail.rebuild')}</button>
        </div>
      )}

      {instance.mountsDrift && (
        <div role="status" className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--warning, var(--accent))' }}>
          <span style={{ fontSize: 13, flex: 1 }}>{t('detail.mountsDriftNotice')}</span>
          {/* No "apply live" counterpart: sbx refuses to add a workspace to an existing
              sandbox, so rebuilding is the only way to attach a newly added folder. */}
          <button className="btn btn-primary btn-sm" title={t('detail.rebuildHint')} onClick={() => onRebuild(instance.name)}>↻ {t('detail.rebuild')}</button>
        </div>
      )}

      <SessionBackups name={instance.name} />

      <div role="tablist" className="tabs detail-tabs" style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--border)', marginBottom: 'var(--space-5)' }}>
        <button role="tab" aria-selected={tab === 'terminals'} style={tabStyle(tab === 'terminals')} onClick={() => setTab('terminals')}>{t('detail.tabTerminals')}</button>
        <button role="tab" aria-selected={tab === 'files'} style={tabStyle(tab === 'files')} onClick={() => setTab('files')}>{t('detail.tabFiles')}</button>
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
        <button role="tab" aria-selected={tab === 'metadata'} style={tabStyle(tab === 'metadata')} onClick={() => setTab('metadata')}>{t('detail.tabMetadata')}</button>
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
      {tab === 'files' && (
        <FilesTab
          running={running}
          hostDir={hostDir}
          sandboxDir={sandboxDir}
          onSetHostDir={saveHostDir}
          onSetSandboxDir={saveSandboxDir}
          listDir={async (path) => { const r = await api.instanceFsListDir(instance.name, path); return r.ok ? r.data : null }}
          plan={async (direction, sources, dst) => { const r = await api.instanceFsPlan(instance.name, direction, sources, dst, { host: hostDir, sandbox: sandboxDir }); return r.ok ? r.data : null }}
          copy={async (direction, sources, dst) => { const r = await api.instanceFsCopy(instance.name, direction, sources, dst); return r.ok ? r.data : null }}
          pickPaths={(mode) => api.pickPaths(mode)}
          pickFolder={() => api.pickFolder()}
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
          stats={stats}
          running={running}
          onFetchStats={() => void onFetchStats()}
          captureSlot={
            <CaptureCard
              status={capture}
              sandbox={instance.name}
              running={running}
              hasCa={hasCa}
              onEnable={async (force) => { const r = await api.captureEnable(instance.name, force); if (r.ok) setCapture(r.data) }}
              onDisable={async () => { const r = await api.captureDisable(); if (r.ok) setCapture(r.data) }}
              onOpenShell={() => onShell(instance.name)}
            />
          }
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
      {tab === 'metadata' && (
        <MetadataTab
          tags={tags}
          onChange={(next) => { setTags(next); onSetTags(instance.name, next) }}
          createdAt={instance.createdAt}
        />
      )}
    </section>
  )
}
