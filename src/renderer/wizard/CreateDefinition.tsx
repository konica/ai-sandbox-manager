import { useEffect, useReducer, useState } from 'react'
import type { Tier, DefinitionSpec } from '@shared/types'
import { serviceById } from '@shared/services'
import { api } from '../ipc/client'
import { draftReducer, initialDraft, draftFromSpec, canAdvance, toSpec, parsePort, resolveBaseImage, effectiveName, basename, TOTAL_STEPS, BUILTIN_VARIANTS, type BuiltinVariant } from './draft'
import { CredentialsStep } from './CredentialsStep'
import { useT } from '../i18n'

const TIERS: { value: Tier; descKey: string }[] = [
  { value: 'open', descKey: 'wizard.tierOpenDesc' },
  { value: 'balanced', descKey: 'wizard.tierBalancedDesc' },
  { value: 'locked', descKey: 'wizard.tierLockedDesc' }
]

type EnvHit = { serviceId: string; label: string; envVar: string; masked: string }

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
  const [portInput, setPortInput] = useState('')
  const [portLabel, setPortLabel] = useState('')
  const [folderInput, setFolderInput] = useState('')
  const [envHits, setEnvHits] = useState<EnvHit[]>([])
  const [error, setError] = useState<string | null>(null)

  // Scan the host environment for known service API keys when the Credentials step opens.
  useEffect(() => {
    if (draft.step !== 5) return
    let alive = true
    void api.credScanEnv().then((r) => { if (alive && r.ok) setEnvHits(r.data) })
    return () => { alive = false }
  }, [draft.step])

  async function submit(): Promise<void> {
    const spec = initial
      ? toSpec(draft, initial.definition.id, initial.definition.createdAt)
      : toSpec(draft, createId(), now())
    const res = initial ? await api.defUpdate(spec) : await api.defCreate(spec)
    if (res.ok) onDone()
    else setError(res.error.message)
  }

  const row = { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' } as const
  const stepKeys = ['workspace', 'baseImage', 'network', 'ports', 'credentials', 'review']

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

          {draft.step === 4 && (
            <>
              <label>{t('wizard.steps.ports')}</label>
              <p className="section-desc" style={{ marginTop: 0 }}>{t('wizard.portsHelp')}</p>
              <div style={row}>
                <input aria-label="Port mapping" className="input input-mono" placeholder={t('wizard.portPlaceholder')} value={portInput} onChange={(e) => setPortInput(e.target.value)} />
                <input aria-label="Port label" className="input" placeholder={t('wizard.portLabelPlaceholder')} value={portLabel} onChange={(e) => setPortLabel(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={() => { const p = parsePort(portInput); if (p) { dispatch({ type: 'addPort', hostPort: p.hostPort, containerPort: p.containerPort, label: portLabel.trim() }); setPortInput(''); setPortLabel('') } }}>{t('wizard.addPort')}</button>
              </div>
              <div>{draft.ports.map((p, i) => (<Chip key={i} text={`${p.hostPort}:${p.containerPort}${p.label ? ` ${p.label}` : ''}`} onRemove={() => dispatch({ type: 'removePort', index: i })} />))}</div>
            </>
          )}

          {draft.step === 5 && (
            <CredentialsStep
              credentials={draft.credentials}
              envHits={envHits}
              onAddService={(serviceId, envVar, value) => dispatch({ type: 'addServiceCred', serviceId, envVar, value })}
              onAddCustom={(cred) => dispatch({ type: 'addCustomCred', cred })}
              onRemove={(index) => dispatch({ type: 'removeCredential', index })}
              onImport={(serviceId) => {
                const svc = serviceById(serviceId)
                if (svc && !draft.credentials.some((c) => c.kind === 'service' && c.serviceId === serviceId))
                  dispatch({ type: 'addServiceCred', serviceId, envVar: svc.envVars[0], value: '' })
              }}
            />
          )}

          {draft.step === 6 && (
            <>
              <h3 style={{ fontSize: 15, marginBottom: 'var(--space-3)' }}>{t('wizard.review')}</h3>
              <table className="table">
                <tbody>
                  <tr><td style={{ color: 'var(--text-muted)' }}>{t('wizard.reviewName')}</td><td>{effectiveName(draft)}</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>{t('wizard.reviewBase')}</td><td><span className="code-inline">{resolveBaseImage(draft)}</span></td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>{t('wizard.reviewWorkspace')}</td><td><span className="code-inline">{draft.workspace}</span> ({draft.workspaceMode})</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>{t('wizard.reviewFolders')}</td><td>{draft.extraFolders.length}</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>{t('wizard.reviewNetwork')}</td><td>{t(`tier.${draft.tier}`)} · {draft.domains.length}</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>{t('wizard.reviewPorts')}</td><td>{draft.ports.length}</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>{t('wizard.reviewCredentials')}</td><td>{draft.credentials.length}</td></tr>
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
