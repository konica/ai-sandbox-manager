import { useReducer, useState } from 'react'
import type { CredentialKind, Tier } from '@shared/types'
import { api } from '../ipc/client'
import { draftReducer, initialDraft, canAdvance, toSpec, parsePort, resolveBaseImage, TOTAL_STEPS, type BuiltinVariant } from './draft'

const VARIANTS: BuiltinVariant[] = ['claude-code-docker', 'claude-code', 'claude-code-minimal']
const TIERS: { value: Tier; label: string; desc: string }[] = [
  { value: 'open', label: 'Open', desc: 'Broad egress. Fewest restrictions.' },
  { value: 'balanced', label: 'Balanced', desc: 'Common developer domains allowed.' },
  { value: 'locked', label: 'Locked Down', desc: 'Deny by default; add only what you need.' }
]
const KINDS: CredentialKind[] = ['git', 'api-key', 'claude-auth']

function Chip({ text, onRemove }: { text: string; onRemove: () => void }): JSX.Element {
  return (
    <span className="tag">{text}<button className="tag-remove" onClick={onRemove} aria-label={`Remove ${text}`}>✕</button></span>
  )
}

export function CreateDefinition({
  onDone,
  onCancel,
  createId = () => crypto.randomUUID(),
  now = () => new Date().toISOString()
}: {
  onDone: () => void
  onCancel: () => void
  createId?: () => string
  now?: () => string
}): JSX.Element {
  const [draft, dispatch] = useReducer(draftReducer, initialDraft)
  const [domainInput, setDomainInput] = useState('')
  const [portInput, setPortInput] = useState('')
  const [portLabel, setPortLabel] = useState('')
  const [folderInput, setFolderInput] = useState('')
  const [credLabel, setCredLabel] = useState('')
  const [credKind, setCredKind] = useState<CredentialKind>('git')
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    const res = await api.defCreate(toSpec(draft, createId(), now()))
    if (res.ok) onDone()
    else setError(res.error.message)
  }

  const row = { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' } as const

  return (
    <section className="screen active">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title" style={{ marginBottom: 0 }}>Create Definition</h2>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>

      <div className="card">
        <div className="wizard-header">
          {Array.from({ length: TOTAL_STEPS }, (_, idx) => {
            const n = idx + 1
            const cls = n === draft.step ? 'active' : n < draft.step ? 'completed' : ''
            return (
              <div key={n} className={`wizard-step ${cls}`}>
                <span className="wizard-step-num">{n}</span>
              </div>
            )
          })}
        </div>

        <div className="wizard-body">
          {draft.step === 1 && (
            <>
              <label htmlFor="def-name">Definition name</label>
              <input id="def-name" aria-label="Name" className="input input-mono" value={draft.name} placeholder="my-sandbox-definition" onChange={(e) => dispatch({ type: 'setField', field: 'name', value: e.target.value })} />
              <label htmlFor="def-desc" style={{ marginTop: 'var(--space-3)' }}>Description (optional)</label>
              <textarea id="def-desc" aria-label="Description" className="input" style={{ minHeight: 80, resize: 'vertical' }} value={draft.description} placeholder="Describe what this sandbox definition is for…" onChange={(e) => dispatch({ type: 'setField', field: 'description', value: e.target.value })} />
            </>
          )}

          {draft.step === 2 && (
            <>
              <label htmlFor="base-image-select">Built-in templates</label>
              <select id="base-image-select" className="input" style={{ fontFamily: 'var(--font-mono)' }} value={draft.imageChoice} onChange={(e) => dispatch({ type: 'setImageChoice', value: e.target.value as BuiltinVariant | 'custom' })}>
                {VARIANTS.map((v) => (<option key={v} value={v}>{v}</option>))}
                <option value="custom">Custom template…</option>
              </select>
              {draft.imageChoice === 'custom' && (
                <>
                  <label htmlFor="custom-image-url" style={{ marginTop: 'var(--space-3)' }}>Image reference</label>
                  <input id="custom-image-url" aria-label="Custom image ref" className="input input-mono" placeholder="docker.io/org/image:tag" value={draft.customImageRef} onChange={(e) => dispatch({ type: 'setField', field: 'customImageRef', value: e.target.value })} />
                </>
              )}
              <p className="section-desc" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>Resolves to <span className="code-inline">{resolveBaseImage(draft) || '—'}</span></p>
            </>
          )}

          {draft.step === 3 && (
            <>
              <label htmlFor="workdir">Working directory</label>
              <input id="workdir" aria-label="Workspace" className="input input-mono" placeholder="/path/to/project" value={draft.workspace} onChange={(e) => dispatch({ type: 'setField', field: 'workspace', value: e.target.value })} />
              <div style={{ display: 'flex', gap: 'var(--space-4)', margin: 'var(--space-3) 0' }}>
                <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}><input type="radio" name="wsmode" checked={draft.workspaceMode === 'direct'} onChange={() => dispatch({ type: 'setWorkspaceMode', mode: 'direct' })} /> Read-write (direct)</label>
                <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}><input type="radio" name="wsmode" checked={draft.workspaceMode === 'clone'} onChange={() => dispatch({ type: 'setWorkspaceMode', mode: 'clone' })} /> Read-only (clone)</label>
              </div>
              {draft.workspaceMode === 'direct' && (
                <div className="card" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning)', fontSize: 12, color: 'var(--text-secondary)' }}>
                  Direct mode exposes files with implicit execution (git hooks, CI config, Makefiles) to edits not visible in a normal diff.
                </div>
              )}
              <label style={{ marginTop: 'var(--space-3)' }}>Extra folders</label>
              <div style={row}>
                <input aria-label="Extra folder path" className="input input-mono" placeholder="/path/to/extra/folder" value={folderInput} onChange={(e) => setFolderInput(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={() => { if (folderInput.trim()) { dispatch({ type: 'addExtraFolder', path: folderInput.trim(), mode: 'clone' }); setFolderInput('') } }}>Add Folder</button>
              </div>
              <div>{draft.extraFolders.map((f, i) => (<Chip key={i} text={`${f.path} (${f.mode})`} onRemove={() => dispatch({ type: 'removeExtraFolder', index: i })} />))}</div>
            </>
          )}

          {draft.step === 4 && (
            <>
              <label>Network policy tier</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                {TIERS.map((t) => (
                  <label key={t.value} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', padding: 'var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                    <input type="radio" name="tier" style={{ marginTop: 3 }} checked={draft.tier === t.value} onChange={() => dispatch({ type: 'setTier', tier: t.value })} />
                    <span><strong style={{ fontSize: 13 }}>{t.label}</strong><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.desc}</div></span>
                  </label>
                ))}
              </div>
              <label>Allowlist (HTTP/HTTPS domains only)</label>
              <div style={row}>
                <input aria-label="Domain" className="input input-mono" placeholder="api.github.com" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={() => { if (domainInput.trim()) { dispatch({ type: 'addDomain', host: domainInput.trim() }); setDomainInput('') } }}>Add Domain</button>
              </div>
              <div>{draft.domains.map((h) => (<Chip key={h} text={h} onRemove={() => dispatch({ type: 'removeDomain', host: h })} />))}</div>
            </>
          )}

          {draft.step === 5 && (
            <>
              <label>Published ports</label>
              <p className="section-desc" style={{ marginTop: 0 }}>Forwarded after launch, bound to <span className="code-inline">127.0.0.1</span>.</p>
              <div style={row}>
                <input aria-label="Port mapping" className="input input-mono" placeholder="8080:3000" value={portInput} onChange={(e) => setPortInput(e.target.value)} />
                <input aria-label="Port label" className="input" placeholder="label" value={portLabel} onChange={(e) => setPortLabel(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={() => { const p = parsePort(portInput); if (p) { dispatch({ type: 'addPort', hostPort: p.hostPort, containerPort: p.containerPort, label: portLabel.trim() }); setPortInput(''); setPortLabel('') } }}>Add Port</button>
              </div>
              <div>{draft.ports.map((p, i) => (<Chip key={i} text={`${p.hostPort}:${p.containerPort}${p.label ? ` ${p.label}` : ''}`} onRemove={() => dispatch({ type: 'removePort', index: i })} />))}</div>
            </>
          )}

          {draft.step === 6 && (
            <>
              <label>Credentials</label>
              <p className="section-desc" style={{ marginTop: 0 }}>Declarations only — values are set securely at launch.</p>
              <div style={row}>
                <input aria-label="Credential label" className="input" placeholder="GitHub token" value={credLabel} onChange={(e) => setCredLabel(e.target.value)} />
                <select aria-label="Credential kind" className="input" style={{ maxWidth: 160 }} value={credKind} onChange={(e) => setCredKind(e.target.value as CredentialKind)}>
                  {KINDS.map((k) => (<option key={k} value={k}>{k}</option>))}
                </select>
                <button className="btn btn-secondary btn-sm" onClick={() => { if (credLabel.trim()) { dispatch({ type: 'addCredential', label: credLabel.trim(), kind: credKind }); setCredLabel('') } }}>Add</button>
              </div>
              <div>{draft.credentials.map((c, i) => (<Chip key={i} text={`${c.label} (${c.kind})`} onRemove={() => dispatch({ type: 'removeCredential', index: i })} />))}</div>
            </>
          )}

          {draft.step === 7 && (
            <>
              <h3 style={{ fontSize: 15, marginBottom: 'var(--space-3)' }}>Review</h3>
              <table className="table">
                <tbody>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Name</td><td>{draft.name}</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Base image</td><td><span className="code-inline">{resolveBaseImage(draft)}</span></td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Workspace</td><td><span className="code-inline">{draft.workspace}</span> ({draft.workspaceMode})</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Extra folders</td><td>{draft.extraFolders.length}</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Network</td><td>{draft.tier} · {draft.domains.length} domains</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Ports</td><td>{draft.ports.length}</td></tr>
                  <tr><td style={{ color: 'var(--text-muted)' }}>Credentials</td><td>{draft.credentials.length}</td></tr>
                </tbody>
              </table>
              {error && <p style={{ color: 'var(--danger)' }}>Error: {error}</p>}
            </>
          )}
        </div>

        <div className="wizard-actions">
          <button className="btn btn-ghost" onClick={() => dispatch({ type: 'back' })} disabled={draft.step === 1}>Back</button>
          {draft.step < TOTAL_STEPS ? (
            <button className="btn btn-primary" onClick={() => dispatch({ type: 'next' })} disabled={!canAdvance(draft)}>Next</button>
          ) : (
            <button className="btn btn-primary" onClick={() => void submit()}>Create Definition</button>
          )}
        </div>
      </div>
    </section>
  )
}
