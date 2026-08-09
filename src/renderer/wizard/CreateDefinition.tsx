import { useEffect, useReducer, useRef, useState } from 'react'
import type { Tier, DefinitionSpec } from '@shared/types'
import { serviceById } from '@shared/services'
import { normalizeCommandsYaml } from '@shared/kit-commands'
import { api } from '../ipc/client'
import { draftReducer, initialDraft, draftFromSpec, canAdvance, toSpec, resolveBaseImage, effectiveName, basename, TOTAL_STEPS, BUILTIN_VARIANTS, needsProviderDomainHint, type BuiltinVariant, type DraftCred } from './draft'
import type { AgentId } from '@shared/agents'
import { AGENT_PROFILES } from '@shared/agents'
import { isValidCpus, isValidMemory, isValidDiskSize } from '@shared/resources'
import { CredentialsStep } from './CredentialsStep'
import { PortsStep } from './PortsStep'
import { TierBadge } from '../components/badges'
import { useT } from '../i18n'

const TIERS: { value: Tier; descKey: string }[] = [
  { value: 'open', descKey: 'wizard.tierOpenDesc' },
  { value: 'balanced', descKey: 'wizard.tierBalancedDesc' },
  { value: 'locked', descKey: 'wizard.tierLockedDesc' }
]

type EnvHit = { serviceId: string; label: string; envVar: string; masked: string }

// Review-step summary, e.g. "Anthropic, GitHub + 1 custom + 1 registry". Null when empty.
function credentialsSummary(creds: DraftCred[]): string | null {
  if (creds.length === 0) return null
  const svcNames = creds.filter((c) => c.kind === 'service').map((c) => serviceById((c as { serviceId: string }).serviceId)?.label ?? (c as { serviceId: string }).serviceId)
  const customCount = creds.filter((c) => c.kind === 'custom').length
  const registryCount = creds.filter((c) => c.kind === 'registry').length
  const parts = [...svcNames]
  if (customCount > 0) parts.push(`${customCount} custom`)
  if (registryCount > 0) parts.push(`${registryCount} registry`)
  return parts.join(' + ')
}


// Review-step SSH summary: "Forwarded" / "Off", "+ commit signing" when signing on.
export function sshSummary(d: { sshForwardAgent: boolean; sshCommitSigning: boolean }, t: (k: string) => string): string {
  if (!d.sshForwardAgent) return t('wizard.sshOff')
  return d.sshCommitSigning ? `${t('wizard.sshForwarded')} ${t('wizard.sshPlusSigning')}` : t('wizard.sshForwarded')
}

/** Map a credential-staging failure to a user-facing message: friendly copy for insecure storage,
 *  otherwise the raw staging error. */
export function stageErrorMessage(err: { kind?: string; message: string }, t: (k: string, p?: Record<string, string | number>) => string): string {
  return err.kind === 'insecure-storage' ? t('wizard.insecureStorage') : t('wizard.stageFailed', { message: err.message })
}

function Chip({ text, onRemove }: { text: string; onRemove: () => void }): JSX.Element {
  return (
    <span className="tag">{text}<button className="tag-remove" onClick={onRemove} aria-label={`Remove ${text}`}>✕</button></span>
  )
}

/** A small ⓘ help marker whose hover/focus reveals an explanatory tooltip. */
function InfoDot({ tip }: { tip: string }): JSX.Element {
  return <span className="info-dot" tabIndex={0} role="img" aria-label={tip} title={tip}>ⓘ</span>
}

export function CreateDefinition({
  onDone,
  onCancel,
  initial,
  createId = () => crypto.randomUUID(),
  now = () => new Date().toISOString()
}: {
  onDone: () => void
  onCancel: () => void
  initial?: DefinitionSpec
  createId?: () => string
  now?: () => string
}): JSX.Element {
  const t = useT()
  const isEdit = initial !== undefined
  const [draft, dispatch] = useReducer(draftReducer, initial ? draftFromSpec(initial) : initialDraft)
  const [domainInput, setDomainInput] = useState('')
  const [folderInput, setFolderInput] = useState('')
  const [cfHost, setCfHost] = useState('')
  const [cfDest, setCfDest] = useState('')
  const [cfBrowseOpen, setCfBrowseOpen] = useState(false)
  const cfBrowseRef = useRef<HTMLDivElement>(null)
  // Add a copy-file entry from the add-row inputs; both paths required.
  function addCopyFile(): void {
    const hostPath = cfHost.trim()
    const sandboxPath = cfDest.trim()
    if (!hostPath || !sandboxPath) return
    dispatch({ type: 'addCopyFile', hostPath, sandboxPath })
    setCfHost(''); setCfDest(''); setCfBrowseOpen(false)
  }
  // Close the Browse menu on an outside click (behaves like a real dropdown).
  useEffect(() => {
    if (!cfBrowseOpen) return
    const onDown = (e: MouseEvent): void => { if (cfBrowseRef.current && !cfBrowseRef.current.contains(e.target as Node)) setCfBrowseOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [cfBrowseOpen])
  const [envHits, setEnvHits] = useState<EnvHit[]>([])
  const [sshDetected, setSshDetected] = useState(false)
  const [hostPlatform, setHostPlatform] = useState('')
  const [hostCap, setHostCap] = useState({ cpuCores: 0, totalMemBytes: 0 })
  const [error, setError] = useState<string | null>(null)
  const [kitMsg, setKitMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  // Scan the host environment for known service API keys + SSH agent when the Credentials step opens.
  useEffect(() => {
    if (draft.step !== 4) return
    let alive = true
    void api.credScanEnv().then((r) => { if (alive && r.ok) setEnvHits(r.data) })
    void api.sshDetect().then((r) => { if (!alive || !r.ok) return; setSshDetected(r.data.present); setHostPlatform(r.data.platform) })
    return () => { alive = false }
  }, [draft.step])

  // Seed the network tier from the saved default — new definitions only. Edit mode keeps
  // the definition's own tier (via draftFromSpec).
  useEffect(() => {
    if (isEdit) return
    let alive = true
    void api.prefsGet('defaultTier').then((r) => {
      if (alive && r.ok && (r.data === 'open' || r.data === 'balanced' || r.data === 'locked')) {
        dispatch({ type: 'setTier', tier: r.data })
      }
    })
    return () => { alive = false }
  }, [isEdit])

  // Load host capacity once so the resources step can hint the CPU/memory maximums.
  useEffect(() => {
    let alive = true
    void api.hostCapacity().then((r) => { if (alive && r.ok) setHostCap(r.data) })
    return () => { alive = false }
  }, [])

  // Reset the "saved" indicator to idle shortly after it shows.
  useEffect(() => {
    if (saveState !== 'saved') return
    const id = setTimeout(() => setSaveState('idle'), 2000)
    return () => clearTimeout(id)
  }, [saveState])

  // Persist the current draft (edit → defUpdate, create → defCreate) + stage entered
  // credential values. Runs the same gates as the final Save. Returns false (and shows an
  // inline error) on a gate/IPC failure; performs no navigation and never closes the wizard.
  async function persist(): Promise<boolean> {
    if (!draft.workspace.trim()) { dispatch({ type: 'goToStep', step: 1 }); setError(t('wizard.workspaceRequired')); return false }
    if (!isValidCpus(draft.cpus) || !isValidMemory(draft.memory) || !isValidDiskSize(draft.diskSize)) { dispatch({ type: 'goToStep', step: 2 }); setError(t('wizard.cpusInvalid')); return false }
    const kitCheck = normalizeCommandsYaml(draft.kitCommandsYaml)
    if (!kitCheck.ok) { dispatch({ type: 'goToStep', step: 6 }); setKitMsg({ kind: 'error', text: t('wizard.kitYamlInvalid', { message: kitCheck.error }) }); return false }
    const spec = initial
      ? toSpec(draft, initial.definition.id, initial.definition.createdAt)
      : toSpec(draft, createId(), now())
    const res = initial ? await api.defUpdate(spec) : await api.defCreate(spec)
    if (!res.ok) { setError(res.error.message); return false }
    // Stage each secret value into the host vault, keyed by definition so it survives
    // relaunches and never collides across definitions (never persisted to the spec).
    // Typed values go straight through; imported service creds have their real value
    // fetched host-side (the renderer only ever saw a mask).
    for (const c of draft.credentials) {
      const sub = c.kind === 'service' ? `service:${c.serviceId}` : c.kind === 'registry' ? `registry:${c.id}` : `custom:${c.id}`
      const key = `${spec.definition.id}:${sub}`
      if (c.value.trim()) {
        const staged = await api.credStageValue(key, c.value)
        if (!staged.ok) { setError(stageErrorMessage(staged.error, t)); return false }
      } else if (c.kind === 'service' && c.fromEnv) {
        const staged = await api.credStageFromEnv(key, c.serviceId)
        if (!staged.ok) { setError(stageErrorMessage(staged.error, t)); return false }
      }
    }
    return true
  }

  async function submit(): Promise<void> {
    if (await persist()) onDone()
  }

  // Navigate between steps. In edit mode this auto-saves the current draft first and aborts
  // the move if saving fails a gate; in create mode it's a plain step change (persist only at
  // the final Create). Kept snappy: saving is a local IPC + SQLite write.
  async function go(step: number): Promise<void> {
    if (!isEdit) { dispatch({ type: 'goToStep', step }); return }
    setSaveState('saving')
    const ok = await persist()
    if (!ok) { setSaveState('idle'); return } // stay put; error already shown by persist()
    dispatch({ type: 'goToStep', step })
    setSaveState('saved')
  }

  const cpuMax = hostCap.cpuCores > 0 ? hostCap.cpuCores : undefined
  const cpuStructuralValid = isValidCpus(draft.cpus)
  const cpuOverMax = cpuStructuralValid && cpuMax !== undefined && !isValidCpus(draft.cpus, cpuMax)
  const memGb = hostCap.totalMemBytes > 0 ? Math.round(hostCap.totalMemBytes / 1024 ** 3) : 0

  const row = { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' } as const
  const folderRowStyle = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '8px 12px', background: 'var(--surface-2, rgba(127,127,127,.08))', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' } as const
  const accessPillStyle = { flexShrink: 0, border: '1px solid var(--border)', borderRadius: 999, padding: '2px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', background: 'var(--surface, #fff)', color: 'var(--text-secondary)', cursor: 'pointer' } as const
  const folderRemoveStyle = { flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2 } as const
  const stepKeys = ['workspace', 'baseImage', 'network', 'credentials', 'ports', 'advanced', 'review']

  return (
    <section className="screen active">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title" style={{ marginBottom: 0 }}>{initial ? t('common.editSandboxNamed', { name: initial.definition.name }) : t('common.createSandbox')}</h2>
        <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>

      <div className="card">
        <div className="wizard-header">
          {Array.from({ length: TOTAL_STEPS }, (_, idx) => {
            const n = idx + 1
            const cls = n === draft.step ? 'active' : n < draft.step ? 'completed' : ''
            // Step headers are clickable to jump only when editing (all steps already valid);
            // during create the flow stays linear (Next/Back).
            const content = <><span className="wizard-step-num">{n}</span>{t(`wizard.steps.${stepKeys[idx]}`)}</>
            return isEdit ? (
              <button key={n} type="button" className={`wizard-step ${cls}`} onClick={() => void go(n)}
                style={{ background: 'none', border: 'none', font: 'inherit', cursor: 'pointer' }}>
                {content}
              </button>
            ) : (
              <div key={n} className={`wizard-step ${cls}`}>{content}</div>
            )
          })}
        </div>

        <div className="wizard-body">
          {draft.step === 1 && (
            <>
              <label htmlFor="def-name">{t('wizard.nameLabel')}</label>
              <input id="def-name" aria-label="Name" className="input input-mono" value={draft.name} placeholder={basename(draft.workspace) || t('wizard.namePlaceholder')} onChange={(e) => dispatch({ type: 'setField', field: 'name', value: e.target.value })} />
              <p className="section-desc" style={{ marginTop: 'var(--space-1)', marginBottom: 0, fontSize: 11 }}>{t('wizard.nameHint')}</p>
              <label htmlFor="def-desc" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.descLabel')}</label>
              <textarea id="def-desc" aria-label="Description" className="input" style={{ minHeight: 70, resize: 'vertical' }} value={draft.description} placeholder={t('wizard.descPlaceholder')} onChange={(e) => dispatch({ type: 'setField', field: 'description', value: e.target.value })} />

              {error && <p style={{ color: 'var(--danger)', marginTop: 'var(--space-3)', marginBottom: 0 }}>{error}</p>}
              <label htmlFor="workdir" style={{ marginTop: 'var(--space-4)' }}>{t('wizard.workdirLabel')} <span style={{ color: 'var(--danger)' }}>*</span></label>
              <div style={row}>
                <input id="workdir" aria-label="Workspace" className="input input-mono" style={{ flex: 1 }} placeholder="/path/to/project" value={draft.workspace} onChange={(e) => dispatch({ type: 'setField', field: 'workspace', value: e.target.value })} />
                <button className="btn btn-secondary" onClick={async () => { const p = await api.pickFolder(); if (p) dispatch({ type: 'setField', field: 'workspace', value: p }) }}>{t('common.browse')}</button>
              </div>
              <label style={{ marginTop: 'var(--space-3)' }}>{t('wizard.extraFolders')}</label>
              <div style={row}>
                <input aria-label="Extra folder path" className="input input-mono" style={{ flex: 1 }} placeholder={t('wizard.extraPlaceholder')} value={folderInput} onChange={(e) => setFolderInput(e.target.value)} />
                <button className="btn btn-secondary" onClick={async () => { const p = await api.pickFolder(); if (p) setFolderInput(p) }}>{t('common.browse')}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { if (folderInput.trim()) { dispatch({ type: 'addExtraFolder', path: folderInput.trim(), mode: 'clone' }); setFolderInput('') } }}>{t('wizard.addFolder')}</button>
              </div>
              {draft.extraFolders.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'var(--space-2)' }}>
                  {draft.extraFolders.map((f, i) => {
                    const rw = f.mode === 'direct'
                    return (
                      <div key={i} style={folderRowStyle}>
                        <span style={{ flex: '1 1 auto', fontFamily: 'var(--font-mono, monospace)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>{f.path}</span>
                        <button
                          type="button"
                          aria-label={`Access for ${f.path}: ${rw ? t('wizard.modeReadWrite') : t('wizard.modeReadOnly')} (click to toggle)`}
                          title={t('wizard.folderAccessToggle')}
                          style={accessPillStyle}
                          onClick={() => dispatch({ type: 'setExtraFolderMode', index: i, mode: rw ? 'clone' : 'direct' })}
                        >
                          {rw ? t('wizard.modeReadWrite') : t('wizard.modeReadOnly')}
                        </button>
                        <button type="button" aria-label={`Remove ${f.path}`} style={folderRemoveStyle} onClick={() => dispatch({ type: 'removeExtraFolder', index: i })}>✕</button>
                      </div>
                    )
                  })}
                </div>
              )}
              <label style={{ marginTop: 'var(--space-3)' }}>
                {t('wizard.copyFilesLabel')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({t('wizard.copyFilesVia')} <code className="code-inline">sbx cp</code>)</span>
              </label>
              <p className="section-desc" style={{ marginTop: 0, marginBottom: 'var(--space-3)', fontSize: 11 }}>{t('wizard.copyFilesHint')}</p>

              {/* Add row — above the added entries */}
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-1)', flex: 1 }}>
                  <input aria-label="Copy host source path" className="input input-mono" style={{ flex: 1 }} placeholder={t('wizard.copyFilesHostPlaceholder')} value={cfHost}
                    onChange={(e) => setCfHost(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCopyFile() } }} />
                  <div ref={cfBrowseRef} style={{ position: 'relative' }}>
                    <button type="button" className="btn btn-secondary" style={{ flexShrink: 0 }} aria-label="Browse host source path" aria-haspopup="menu" aria-expanded={cfBrowseOpen} onClick={() => setCfBrowseOpen((v) => !v)}>{t('wizard.copyFilesBrowse')}</button>
                    {cfBrowseOpen && (
                      <div role="menu" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', minWidth: 160, marginTop: 4, overflow: 'hidden' }}>
                        <button type="button" role="menuitem" className="browse-menu-item" style={{ display: 'block', width: '100%', padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                          onClick={async () => { setCfBrowseOpen(false); const p = await api.pickFile(); if (p) setCfHost(p) }}>{t('wizard.copyFilesBrowseFile')}</button>
                        <button type="button" role="menuitem" className="browse-menu-item" style={{ display: 'block', width: '100%', padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                          onClick={async () => { setCfBrowseOpen(false); const p = await api.pickFolder(); if (p) setCfHost(p) }}>{t('wizard.copyFilesBrowseFolder')}</button>
                      </div>
                    )}
                  </div>
                </div>
                <input aria-label="Copy sandbox destination" className="input input-mono" style={{ flex: 1 }} placeholder={t('wizard.copyFilesSandboxPlaceholder')} value={cfDest}
                  onChange={(e) => setCfDest(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCopyFile() } }} />
                <button type="button" className="btn btn-secondary" onClick={addCopyFile}>{t('wizard.copyFilesAdd')}</button>
              </div>

              {/* Added entries — read-only pills */}
              {draft.copyFiles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                  {draft.copyFiles.map((cf, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cf.hostPath}>{cf.hostPath}</span>
                      <span aria-hidden style={{ flexShrink: 0, color: 'var(--text-muted)' }}>→</span>
                      <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cf.sandboxPath}>{cf.sandboxPath}</span>
                      <button type="button" aria-label={`${t('wizard.copyFilesRemove')} ${cf.hostPath}`} className="tag-remove" onClick={() => dispatch({ type: 'removeCopyFile', index: i })}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {draft.step === 2 && (
            <>
              <label htmlFor="base-image-select">{t('wizard.builtinTemplates')}</label>
              <select id="base-image-select" className="input" style={{ fontFamily: 'var(--font-mono)' }} value={draft.imageChoice} onChange={(e) => dispatch({ type: 'setImageChoice', value: e.target.value as BuiltinVariant | 'custom' })}>
                {BUILTIN_VARIANTS.map((v) => (<option key={v.value} value={v.value}>{v.value} — {v.label}</option>))}
                <option value="custom">{t('wizard.customOption')}</option>
              </select>
              {draft.imageChoice === 'custom' && (
                <>
                  <label htmlFor="custom-image-url" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.imageRefLabel')}</label>
                  <input id="custom-image-url" aria-label="Custom image ref" className="input input-mono" placeholder={t('wizard.imageRefPlaceholder')} value={draft.customImageRef} onChange={(e) => dispatch({ type: 'setField', field: 'customImageRef', value: e.target.value })} />
                  <label htmlFor="agent-select" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.agentLabel')}</label>
                  <select id="agent-select" className="input" style={{ fontFamily: 'var(--font-mono)' }} value={draft.agent} onChange={(e) => dispatch({ type: 'setAgent', value: e.target.value as AgentId })}>
                    {Object.values(AGENT_PROFILES).map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
                  </select>
                </>
              )}
              {draft.imageChoice !== 'custom' && (
                <p className="section-desc" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>{t('wizard.agentLabel')}: {AGENT_PROFILES[draft.agent].label}</p>
              )}
              <p className="section-desc" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>{t('wizard.resolvesTo')} <span className="code-inline">{resolveBaseImage(draft) || '—'}</span></p>

              <label htmlFor="def-cpus" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.cpusLabel')}</label>
              <input
                id="def-cpus"
                aria-label="CPUs"
                className="input input-mono"
                inputMode="numeric"
                placeholder={t('wizard.cpusPlaceholder')}
                value={draft.cpus}
                onChange={(e) => dispatch({ type: 'setField', field: 'cpus', value: e.target.value })}
              />
              {!cpuStructuralValid && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 'var(--space-1)', marginBottom: 0 }}>{t('wizard.cpusInvalid')}</p>}
              {cpuOverMax && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 'var(--space-1)', marginBottom: 0 }}>{t('wizard.cpusExceedsMax', { cores: cpuMax! })}</p>}
              {cpuMax !== undefined && cpuStructuralValid && !cpuOverMax && <p className="section-desc" style={{ fontSize: 11, marginTop: 'var(--space-1)', marginBottom: 0 }}>{t('wizard.cpusMaxHint', { cores: cpuMax })}</p>}

              <label htmlFor="def-memory" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.memoryLabel')}</label>
              <input
                id="def-memory"
                aria-label="Memory"
                className="input input-mono"
                placeholder={t('wizard.memoryPlaceholder')}
                value={draft.memory}
                onChange={(e) => dispatch({ type: 'setField', field: 'memory', value: e.target.value })}
              />
              {!isValidMemory(draft.memory) && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 'var(--space-1)', marginBottom: 0 }}>{t('wizard.memoryInvalid')}</p>}
              {memGb > 0 && <p className="section-desc" style={{ fontSize: 11, marginTop: 'var(--space-1)', marginBottom: 0 }}>{t('wizard.memoryHostHint', { total: memGb })}</p>}

              <label htmlFor="def-disk-size" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.diskSizeLabel')}</label>
              <input
                id="def-disk-size"
                aria-label="Disk size"
                className="input input-mono"
                placeholder={t('wizard.diskSizePlaceholder')}
                value={draft.diskSize}
                onChange={(e) => dispatch({ type: 'setField', field: 'diskSize', value: e.target.value })}
              />
              {!isValidDiskSize(draft.diskSize) && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 'var(--space-1)', marginBottom: 0 }}>{t('wizard.diskSizeInvalid')}</p>}

              <p className="section-desc" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>{t('wizard.resourcesNote')}</p>
            </>
          )}

          {draft.step === 3 && (
            <>
              <label>{t('wizard.networkTier')}<InfoDot tip={t('wizard.networkTierTip')} /></label>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                {TIERS.map((tr) => (
                  <label key={tr.value} style={{ flex: 1, display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', padding: 'var(--space-3)', border: `1px solid ${draft.tier === tr.value ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                    <input type="radio" name="tier" style={{ marginTop: 3 }} checked={draft.tier === tr.value} onChange={() => dispatch({ type: 'setTier', tier: tr.value })} />
                    <span><strong style={{ fontSize: 13 }}>{t(`tier.${tr.value}`)}</strong><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t(tr.descKey)}</div></span>
                  </label>
                ))}
              </div>
              <label>{t('wizard.allowlist')}<InfoDot tip={t('wizard.allowlistTip')} /></label>
              <div style={row}>
                <input aria-label="Domain" className="input input-mono" placeholder={t('wizard.domainPlaceholder')} value={domainInput} onChange={(e) => setDomainInput(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={() => { if (domainInput.trim()) { dispatch({ type: 'addDomain', host: domainInput.trim() }); setDomainInput('') } }}>{t('wizard.addDomain')}</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>{draft.domains.map((h) => (<Chip key={h} text={h} onRemove={() => dispatch({ type: 'removeDomain', host: h })} />))}</div>
              {needsProviderDomainHint(draft) && (
                <p className="section-desc" style={{ marginTop: 'var(--space-2)' }}>{t('wizard.noDomainAgentHint', { agent: AGENT_PROFILES[draft.agent].label })}</p>
              )}
            </>
          )}

          {draft.step === 5 && (
            <PortsStep
              ports={draft.ports}
              hostServices={draft.hostServices}
              onAddPort={(hostPort, containerPort, protocol, label) => dispatch({ type: 'addPort', hostPort, containerPort, protocol, label })}
              onRemovePort={(index) => dispatch({ type: 'removePort', index })}
              onAddHostService={(hostPort, label) => dispatch({ type: 'addHostService', hostPort, label })}
              onRemoveHostService={(index) => dispatch({ type: 'removeHostService', index })}
            />
          )}

          {draft.step === 4 && (
            <CredentialsStep
              credentials={draft.credentials}
              envHits={envHits}
              onAddService={(serviceId, envVar, value) => dispatch({ type: 'addServiceCred', serviceId, envVar, value })}
              onAddCustom={(cred) => dispatch({ type: 'addCustomCred', cred })}
              onAddRegistry={(cred) => dispatch({ type: 'addRegistryCred', cred })}
              ssh={{ forwardAgent: draft.sshForwardAgent, commitSigning: draft.sshCommitSigning }}
              onSshChange={(next) => { dispatch({ type: 'setSshForward', value: next.forwardAgent }); dispatch({ type: 'setSshCommitSigning', value: next.commitSigning }) }}
              sshDetected={sshDetected}
              hostPlatform={hostPlatform}
              onRemove={(index) => dispatch({ type: 'removeCredential', index })}
              onImport={(serviceId) => {
                const svc = serviceById(serviceId)
                if (svc && !draft.credentials.some((c) => c.kind === 'service' && c.serviceId === serviceId))
                  dispatch({ type: 'addServiceCred', serviceId, envVar: svc.envVars[0], value: '', fromEnv: true })
              }}
            />
          )}

          {draft.step === 6 && (
            <>
              <h3 style={{ fontSize: 15, marginBottom: 'var(--space-1)' }}>{t('wizard.advancedTitle')}</h3>
              <p className="section-desc" style={{ marginTop: 0 }}>{t('wizard.advancedSubtitle')} <a href="https://docs.docker.com/ai/sandboxes/customize/kit-reference/" target="_blank" rel="noreferrer">{t('wizard.kitReference')}</a></p>
              <label htmlFor="kit-yaml">{t('wizard.customKitYaml')}</label>
              <textarea
                id="kit-yaml" aria-label="Custom kit YAML" className="input input-mono"
                style={{ minHeight: 160, resize: 'vertical', fontFamily: 'var(--font-mono, monospace)' }}
                placeholder={'commands:\n  install: |\n    apt-get update && apt-get install -y ...\n  startup: |\n    ...\n  initFiles:\n    - path: /home/agent/.config/tool.yaml\n      contents: |\n        ...'}
                value={draft.kitCommandsYaml}
                onChange={(e) => { dispatch({ type: 'setField', field: 'kitCommandsYaml', value: e.target.value }); setKitMsg(null) }}
              />
              <p className="section-desc" style={{ fontSize: 11, marginTop: 'var(--space-1)' }}>{t('wizard.customKitYamlHelp')}</p>
              <div className="card" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--bg-subtle, var(--bg-2))' }}>
                <strong style={{ fontSize: 12 }}>💡 {t('wizard.kitEnvTipTitle')}</strong>
                <p className="section-desc" style={{ fontSize: 12, margin: 'var(--space-1) 0 0' }}>{t('wizard.kitEnvTipBody')}</p>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => {
                  const r = normalizeCommandsYaml(draft.kitCommandsYaml)
                  if (r.ok) { dispatch({ type: 'setField', field: 'kitCommandsYaml', value: r.yaml }); setKitMsg({ kind: 'ok', text: t('wizard.kitReformatted') }) }
                  else setKitMsg({ kind: 'error', text: r.error })
                }}>{t('wizard.reformat')}</button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={async () => {
                  const res = await api.kitValidate(draft.kitCommandsYaml)
                  if (!res.ok) { setKitMsg({ kind: 'error', text: res.error.message }); return }
                  setKitMsg({ kind: res.data.status === 'invalid' ? 'error' : 'ok', text: res.data.message })
                }}>{t('wizard.validate')}</button>
              </div>
              {kitMsg && <p style={{ fontSize: 12, marginTop: 'var(--space-2)', color: kitMsg.kind === 'error' ? 'var(--danger)' : 'var(--success, var(--accent))' }}>{kitMsg.text}</p>}
            </>
          )}

          {draft.step === 7 && (
            <>
              <h3 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>{t('wizard.review')}</h3>
              <p className="section-desc">{t('wizard.reviewSubtitle')}</p>
              <table className="review-table">
                <tbody>
                  <tr><td>{t('wizard.reviewName')}</td><td><span className="code-inline">{effectiveName(draft)}</span></td></tr>
                  {draft.description.trim() && <tr><td>{t('wizard.reviewDescription')}</td><td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{draft.description.trim()}</td></tr>}
                  <tr><td>{t('wizard.reviewBase')}</td><td><span className="code-inline">{resolveBaseImage(draft)}</span></td></tr>
                  <tr><td>{t('wizard.reviewWorkspace')}</td><td><span className="code-inline">{draft.workspace}</span></td></tr>
                  <tr><td>{t('wizard.reviewFolders')}</td><td>{draft.extraFolders.length === 0 ? '—' : draft.extraFolders.map((f, i) => (<span key={i}>{i > 0 && ', '}<span className="code-inline">{f.path}</span> ({f.mode === 'direct' ? t('wizard.modeReadWrite') : t('wizard.modeReadOnly')})</span>))}</td></tr>
                  <tr><td>{t('wizard.reviewNetwork')}</td><td><TierBadge tier={draft.tier} /> — {t('wizard.reviewDomainsAllowlisted', { count: draft.domains.length })}</td></tr>
                  <tr><td>{t('wizard.reviewPorts')}</td><td>{draft.ports.length === 0 ? '—' : (<>{t('wizard.reviewPortRules', { count: draft.ports.length })}: {draft.ports.map((p, i) => (<span key={i}>{i > 0 && ', '}<span className="code-inline">{p.hostPort !== null ? p.hostPort : ''}→{p.containerPort}/{p.protocol}</span></span>))}</>)}</td></tr>
                  {draft.hostServices.length > 0 && <tr><td>{t('wizard.reviewHostServices')}</td><td>{draft.hostServices.map((h, i) => (<span key={i}>{i > 0 && ', '}<span className="code-inline">host.docker.internal:{h.hostPort}</span></span>))}</td></tr>}
                  <tr><td>{t('wizard.reviewCredentials')}</td><td>{credentialsSummary(draft.credentials) ?? '—'}</td></tr>
                  <tr><td>{t('wizard.reviewSsh')}</td><td>{sshSummary(draft, t)}</td></tr>
                  {draft.copyFiles.filter((c) => c.hostPath.trim() && c.sandboxPath.trim()).length > 0 && (
                    <tr><td>{t('wizard.reviewCopyFiles')}</td><td>{t('wizard.reviewCopyFilesCount', { count: draft.copyFiles.filter((c) => c.hostPath.trim() && c.sandboxPath.trim()).length })}</td></tr>
                  )}
                  <tr><td>{t('wizard.reviewAgent')}</td><td>Claude Code</td></tr>
                </tbody>
              </table>
              {error && <p style={{ color: 'var(--danger)' }}>{t('wizard.error')}: {error}</p>}
            </>
          )}
        </div>

        <div className="wizard-actions">
          <button className="btn btn-ghost" onClick={() => void go(draft.step - 1)} disabled={draft.step === 1}>{t('common.back')}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {isEdit && (
              <span
                aria-live="polite"
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  minWidth: 64,
                  textAlign: 'right',
                  opacity: saveState === 'idle' ? 0 : 1,
                  transition: 'opacity 150ms ease',
                }}
              >
                {saveState === 'saving' ? t('wizard.saving') : saveState === 'saved' ? t('wizard.saved') : ''}
              </span>
            )}
            {draft.step < TOTAL_STEPS ? (
              <button className="btn btn-primary" onClick={() => void go(draft.step + 1)} disabled={!canAdvance(draft) || (draft.step === 2 && cpuOverMax)}>{t('common.next')}</button>
            ) : (
              <button className="btn btn-primary" onClick={() => void submit()} disabled={!draft.workspace.trim()} title={!draft.workspace.trim() ? t('wizard.workspaceRequired') : undefined}>{isEdit ? t('common.save') : t('common.createSandbox')}</button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
