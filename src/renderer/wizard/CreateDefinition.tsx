import { useReducer, useState } from 'react'
import type { CredentialKind, Tier } from '@shared/types'
import { api } from '../ipc/client'
import { draftReducer, initialDraft, canAdvance, toSpec, parsePort, resolveBaseImage, TOTAL_STEPS, type BuiltinVariant } from './draft'

const VARIANTS: BuiltinVariant[] = ['claude-code-docker', 'claude-code', 'claude-code-minimal']
const TIERS: Tier[] = ['open', 'balanced', 'locked']
const KINDS: CredentialKind[] = ['git', 'api-key', 'claude-auth']

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

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>Create Definition</h1>
        <button onClick={onCancel}>Cancel</button>
      </div>
      <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>Step {draft.step} of {TOTAL_STEPS}</p>

      {draft.step === 1 && (
        <div>
          <label>Name<br /><input aria-label="Name" value={draft.name} onChange={(e) => dispatch({ type: 'setField', field: 'name', value: e.target.value })} /></label>
          <br /><label>Description<br /><textarea aria-label="Description" value={draft.description} onChange={(e) => dispatch({ type: 'setField', field: 'description', value: e.target.value })} /></label>
        </div>
      )}

      {draft.step === 2 && (
        <div>
          <p>Base image</p>
          {VARIANTS.map((v) => (
            <label key={v} style={{ display: 'block' }}>
              <input type="radio" name="image" checked={draft.imageChoice === v} onChange={() => dispatch({ type: 'setImageChoice', value: v })} /> {v}
            </label>
          ))}
          <label style={{ display: 'block' }}>
            <input type="radio" name="image" checked={draft.imageChoice === 'custom'} onChange={() => dispatch({ type: 'setImageChoice', value: 'custom' })} /> Custom template
          </label>
          {draft.imageChoice === 'custom' && (
            <input aria-label="Custom image ref" placeholder="docker.io/org/img:tag" value={draft.customImageRef} onChange={(e) => dispatch({ type: 'setField', field: 'customImageRef', value: e.target.value })} />
          )}
          <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Resolves to: {resolveBaseImage(draft) || '—'}</p>
        </div>
      )}

      {draft.step === 3 && (
        <div>
          <label>Workspace directory<br /><input aria-label="Workspace" value={draft.workspace} onChange={(e) => dispatch({ type: 'setField', field: 'workspace', value: e.target.value })} /></label>
          <div>
            <label><input type="radio" name="wsmode" checked={draft.workspaceMode === 'direct'} onChange={() => dispatch({ type: 'setWorkspaceMode', mode: 'direct' })} /> Read-write (direct)</label>
            <label><input type="radio" name="wsmode" checked={draft.workspaceMode === 'clone'} onChange={() => dispatch({ type: 'setWorkspaceMode', mode: 'clone' })} /> Read-only (clone)</label>
          </div>
          {draft.workspaceMode === 'direct' && (
            <p style={{ color: 'var(--danger)', fontSize: 12 }}>Direct mode exposes files with implicit execution (git hooks, CI config, Makefiles) to edits not visible in a normal diff.</p>
          )}
          <div>
            <p>Extra folders</p>
            <input aria-label="Extra folder path" value={folderInput} onChange={(e) => setFolderInput(e.target.value)} />
            <button onClick={() => { if (folderInput.trim()) { dispatch({ type: 'addExtraFolder', path: folderInput.trim(), mode: 'clone' }); setFolderInput('') } }}>Add folder</button>
            <ul>{draft.extraFolders.map((f, i) => (<li key={i}>{f.path} ({f.mode}) <button onClick={() => dispatch({ type: 'removeExtraFolder', index: i })}>remove</button></li>))}</ul>
          </div>
        </div>
      )}

      {draft.step === 4 && (
        <div>
          <p>Network policy tier</p>
          {TIERS.map((t) => (
            <label key={t} style={{ display: 'block' }}>
              <input type="radio" name="tier" checked={draft.tier === t} onChange={() => dispatch({ type: 'setTier', tier: t })} /> {t}
            </label>
          ))}
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>Allowlist (HTTP/HTTPS domains only)</p>
          <input aria-label="Domain" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} />
          <button onClick={() => { if (domainInput.trim()) { dispatch({ type: 'addDomain', host: domainInput.trim() }); setDomainInput('') } }}>Add domain</button>
          <ul>{draft.domains.map((h) => (<li key={h}>{h} <button onClick={() => dispatch({ type: 'removeDomain', host: h })}>remove</button></li>))}</ul>
        </div>
      )}

      {draft.step === 5 && (
        <div>
          <p>Published ports (forwarded after launch, bound to 127.0.0.1)</p>
          <input aria-label="Port mapping" placeholder="8080:3000" value={portInput} onChange={(e) => setPortInput(e.target.value)} />
          <input aria-label="Port label" placeholder="label" value={portLabel} onChange={(e) => setPortLabel(e.target.value)} />
          <button onClick={() => { const p = parsePort(portInput); if (p) { dispatch({ type: 'addPort', hostPort: p.hostPort, containerPort: p.containerPort, label: portLabel.trim() }); setPortInput(''); setPortLabel('') } }}>Add port</button>
          <ul>{draft.ports.map((p, i) => (<li key={i}>{p.hostPort}:{p.containerPort} {p.label} <button onClick={() => dispatch({ type: 'removePort', index: i })}>remove</button></li>))}</ul>
        </div>
      )}

      {draft.step === 6 && (
        <div>
          <p>Credentials (declarations only — values are set at launch)</p>
          <input aria-label="Credential label" value={credLabel} onChange={(e) => setCredLabel(e.target.value)} />
          <select aria-label="Credential kind" value={credKind} onChange={(e) => setCredKind(e.target.value as CredentialKind)}>
            {KINDS.map((k) => (<option key={k} value={k}>{k}</option>))}
          </select>
          <button onClick={() => { if (credLabel.trim()) { dispatch({ type: 'addCredential', label: credLabel.trim(), kind: credKind }); setCredLabel('') } }}>Add credential</button>
          <ul>{draft.credentials.map((c, i) => (<li key={i}>{c.label} ({c.kind}) <button onClick={() => dispatch({ type: 'removeCredential', index: i })}>remove</button></li>))}</ul>
        </div>
      )}

      {draft.step === 7 && (
        <div>
          <h2>Review</h2>
          <ul style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            <li>Name: {draft.name}</li>
            <li>Base image: {resolveBaseImage(draft)}</li>
            <li>Workspace: {draft.workspace} ({draft.workspaceMode})</li>
            <li>Extra folders: {draft.extraFolders.length}</li>
            <li>Tier: {draft.tier} · {draft.domains.length} domains</li>
            <li>Ports: {draft.ports.length}</li>
            <li>Credentials: {draft.credentials.length}</li>
          </ul>
          {error && <p style={{ color: 'var(--danger)' }}>Error: {error}</p>}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={() => dispatch({ type: 'back' })} disabled={draft.step === 1}>Back</button>
        {draft.step < TOTAL_STEPS ? (
          <button onClick={() => dispatch({ type: 'next' })} disabled={!canAdvance(draft)}>Next</button>
        ) : (
          <button onClick={() => void submit()}>Create Definition</button>
        )}
      </div>
    </div>
  )
}
