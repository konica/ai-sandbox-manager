import { useEffect, useReducer, useState } from 'react'
import type { Tier, DefinitionSpec } from '@shared/types'
import { serviceById } from '@shared/services'
import { api } from '../ipc/client'
import { draftReducer, initialDraft, draftFromSpec, canAdvance, toSpec, resolveBaseImage, effectiveName, basename, TOTAL_STEPS, BUILTIN_VARIANTS, type BuiltinVariant } from './draft'
import { CredentialsStep } from './CredentialsStep'
import { PortsStep } from './PortsStep'
import { TierBadge } from '../components/badges'

const lblCell = { color: 'var(--text-muted)', width: '30%', verticalAlign: 'top' as const }
import { useT } from '../i18n'

const TIERS: { value: Tier; descKey: string }[] = [
  { value: 'open', descKey: 'wizard.tierOpenDesc' },
  { value: 'balanced', descKey: 'wizard.tierBalancedDesc' },
  { value: 'locked', descKey: 'wizard.tierLockedDesc' }
]

type EnvHit = { serviceId: string; label: string; envVar: string; masked: string }

// Review-step summary, e.g. "Anthropic, GitHub + 1 custom". Null when empty.
function credentialsSummary(creds: { kind: 'service' | 'custom'; serviceId?: string }[]): string | null {
  if (creds.length === 0) return null
  const svcNames = creds.filter((c) => c.kind === 'service').map((c) => serviceById(c.serviceId ?? '')?.label ?? c.serviceId ?? '')
  const customCount = creds.filter((c) => c.kind === 'custom').length
  const parts = [...svcNames]
  if (customCount > 0) parts.push(`${customCount} custom`)
  return parts.join(' + ')
}


function Chip({ text, onRemove }: { text: string; onRemove: () => void }): JSX.Element {
  return (
    <span className="tag">{text}<button className="tag-remove" onClick={onRemove} aria-label={`Remove ${text}`}>✕</button></span>
  )
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
  const [envHits, setEnvHits] = useState<EnvHit[]>([])
  const [error, setError] = useState<string | null>(null)

  // Scan the host environment for known service API keys when the Credentials step opens.
  useEffect(() => {
    if (draft.step !== 4) return
    let alive = true
    void api.credScanEnv().then((r) => { if (alive && r.ok) setEnvHits(r.data) })
    return () => { alive = false }
  }, [draft.step])

  async function submit(): Promise<void> {
    const spec = initial
      ? toSpec(draft, initial.definition.id, initial.definition.createdAt)
      : toSpec(draft, createId(), now())
    const res = initial ? await api.defUpdate(spec) : await api.defCreate(spec)
    if (!res.ok) { setError(res.error.message); return }
    // Stage each secret value into the host vault, keyed by definition so it survives
    // relaunches and never collides across definitions (never persisted to the spec).
    // Typed values go straight through; imported service creds have their real value
    // fetched host-side (the renderer only ever saw a mask).
    for (const c of draft.credentials) {
      const sub = c.kind === 'service' ? `service:${c.serviceId}` : `custom:${c.id}`
      const key = `${spec.definition.id}:${sub}`
      if (c.value.trim()) {
        const staged = await api.credStageValue(key, c.value)
        if (!staged.ok) { setError(t('wizard.stageFailed', { message: staged.error.message })); return }
      } else if (c.kind === 'service' && c.fromEnv) {
        const staged = await api.credStageFromEnv(key, c.serviceId)
        if (!staged.ok) { setError(t('wizard.stageFailed', { message: staged.error.message })); return }
      }
    }
    onDone()
  }

  const row = { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' } as const
  const stepKeys = ['workspace', 'baseImage', 'network', 'credentials', 'ports', 'review']

  return (
    <section className="screen active">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title" style={{ marginBottom: 0 }}>{isEdit ? t('common.editSandbox') : t('common.createSandbox')}</h2>
        <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
      </div>

      <div className="card">
        <div className="wizard-header">
          {Array.from({ length: TOTAL_STEPS }, (_, idx) => {
            const n = idx + 1
            const cls = n === draft.step ? 'active' : n < draft.step ? 'completed' : ''
            return (
              <div key={n} className={`wizard-step ${cls}`}>
                <span className="wizard-step-num">{n}</span>
                {t(`wizard.steps.${stepKeys[idx]}`)}
              </div>
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

              <label htmlFor="workdir" style={{ marginTop: 'var(--space-4)' }}>{t('wizard.workdirLabel')} <span style={{ color: 'var(--danger)' }}>*</span></label>
              <div style={row}>
                <input id="workdir" aria-label="Workspace" className="input input-mono" style={{ flex: 1 }} placeholder="/path/to/project" value={draft.workspace} onChange={(e) => dispatch({ type: 'setField', field: 'workspace', value: e.target.value })} />
                <button className="btn btn-secondary" onClick={async () => { const p = await api.pickFolder(); if (p) dispatch({ type: 'setField', field: 'workspace', value: p }) }}>{t('common.browse')}</button>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-4)', margin: 'var(--space-3) 0' }}>
                <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}><input type="radio" name="wsmode" checked={draft.workspaceMode === 'direct'} onChange={() => dispatch({ type: 'setWorkspaceMode', mode: 'direct' })} /> {t('wizard.modeDirect')}</label>
                <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}><input type="radio" name="wsmode" checked={draft.workspaceMode === 'clone'} onChange={() => dispatch({ type: 'setWorkspaceMode', mode: 'clone' })} /> {t('wizard.modeClone')}</label>
              </div>
              {draft.workspaceMode === 'direct' && (
                <div className="card" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning)', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {t('wizard.directWarning')}
                </div>
              )}
              <label style={{ marginTop: 'var(--space-3)' }}>{t('wizard.extraFolders')}</label>
              <div style={row}>
                <input aria-label="Extra folder path" className="input input-mono" style={{ flex: 1 }} placeholder={t('wizard.extraPlaceholder')} value={folderInput} onChange={(e) => setFolderInput(e.target.value)} />
                <button className="btn btn-secondary" onClick={async () => { const p = await api.pickFolder(); if (p) setFolderInput(p) }}>{t('common.browse')}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { if (folderInput.trim()) { dispatch({ type: 'addExtraFolder', path: folderInput.trim(), mode: 'clone' }); setFolderInput('') } }}>{t('wizard.addFolder')}</button>
              </div>
              <div>{draft.extraFolders.map((f, i) => (<Chip key={i} text={`${f.path} (${f.mode})`} onRemove={() => dispatch({ type: 'removeExtraFolder', index: i })} />))}</div>
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
                </>
              )}
              <p className="section-desc" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>{t('wizard.resolvesTo')} <span className="code-inline">{resolveBaseImage(draft) || '—'}</span></p>
            </>
          )}

          {draft.step === 3 && (
            <>
              <label>{t('wizard.networkTier')}</label>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                {TIERS.map((tr) => (
                  <label key={tr.value} style={{ flex: 1, display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', padding: 'var(--space-3)', border: `1px solid ${draft.tier === tr.value ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                    <input type="radio" name="tier" style={{ marginTop: 3 }} checked={draft.tier === tr.value} onChange={() => dispatch({ type: 'setTier', tier: tr.value })} />
                    <span><strong style={{ fontSize: 13 }}>{t(`tier.${tr.value}`)}</strong><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t(tr.descKey)}</div></span>
                  </label>
                ))}
              </div>
              <label>{t('wizard.allowlist')}</label>
              <div style={row}>
                <input aria-label="Domain" className="input input-mono" placeholder={t('wizard.domainPlaceholder')} value={domainInput} onChange={(e) => setDomainInput(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={() => { if (domainInput.trim()) { dispatch({ type: 'addDomain', host: domainInput.trim() }); setDomainInput('') } }}>{t('wizard.addDomain')}</button>
              </div>
              <div>{draft.domains.map((h) => (<Chip key={h} text={h} onRemove={() => dispatch({ type: 'removeDomain', host: h })} />))}</div>
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
              <h3 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>{t('wizard.review')}</h3>
              <p className="section-desc">{t('wizard.reviewSubtitle')}</p>
              <table className="table">
                <tbody>
                  <tr><td style={lblCell}>{t('wizard.reviewName')}</td><td><span className="code-inline">{effectiveName(draft)}</span></td></tr>
                  {draft.description.trim() && <tr><td style={lblCell}>{t('wizard.reviewDescription')}</td><td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{draft.description.trim()}</td></tr>}
                  <tr><td style={lblCell}>{t('wizard.reviewBase')}</td><td><span className="code-inline">{resolveBaseImage(draft)}</span></td></tr>
                  <tr><td style={lblCell}>{t('wizard.reviewWorkspace')}</td><td><span className="code-inline">{draft.workspace}</span></td></tr>
                  <tr><td style={lblCell}>{t('wizard.reviewMountMode')}</td><td><span className="code-inline">{draft.workspaceMode}</span> ({draft.workspaceMode === 'direct' ? t('wizard.modeReadWrite') : t('wizard.modeReadOnly')})</td></tr>
                  <tr><td style={lblCell}>{t('wizard.reviewFolders')}</td><td>{draft.extraFolders.length === 0 ? '—' : draft.extraFolders.map((f, i) => (<span key={i}>{i > 0 && ', '}<span className="code-inline">{f.path}</span> ({f.mode})</span>))}</td></tr>
                  <tr><td style={lblCell}>{t('wizard.reviewNetwork')}</td><td><TierBadge tier={draft.tier} /> — {t('wizard.reviewDomainsAllowlisted', { count: draft.domains.length })}</td></tr>
                  <tr><td style={lblCell}>{t('wizard.reviewPorts')}</td><td>{draft.ports.length === 0 ? '—' : (<>{t('wizard.reviewPortRules', { count: draft.ports.length })}: {draft.ports.map((p, i) => (<span key={i}>{i > 0 && ', '}<span className="code-inline">{p.hostPort !== null ? p.hostPort : ''}→{p.containerPort}/{p.protocol}</span></span>))}</>)}</td></tr>
                  {draft.hostServices.length > 0 && <tr><td style={lblCell}>{t('wizard.reviewHostServices')}</td><td>{draft.hostServices.map((h, i) => (<span key={i}>{i > 0 && ', '}<span className="code-inline">host.docker.internal:{h.hostPort}</span></span>))}</td></tr>}
                  <tr><td style={lblCell}>{t('wizard.reviewCredentials')}</td><td>{credentialsSummary(draft.credentials) ?? '—'}</td></tr>
                  <tr><td style={lblCell}>{t('wizard.reviewAgent')}</td><td>Claude Code</td></tr>
                </tbody>
              </table>
              {error && <p style={{ color: 'var(--danger)' }}>{t('wizard.error')}: {error}</p>}
            </>
          )}
        </div>

        <div className="wizard-actions">
          <button className="btn btn-ghost" onClick={() => dispatch({ type: 'back' })} disabled={draft.step === 1}>{t('common.back')}</button>
          {draft.step < TOTAL_STEPS ? (
            <button className="btn btn-primary" onClick={() => dispatch({ type: 'next' })} disabled={!canAdvance(draft)}>{t('common.next')}</button>
          ) : (
            <button className="btn btn-primary" onClick={() => void submit()}>{isEdit ? t('common.save') : t('common.createSandbox')}</button>
          )}
        </div>
      </div>
    </section>
  )
}
