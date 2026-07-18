import { useState } from 'react'
import type { Definition } from '@shared/types'
import { useT } from '../i18n'

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: 'var(--space-4) 0 var(--space-2)' } as const

/**
 * Launch dialog. Two distinct names:
 *  - Session name → the Claude Code session display name (`claude --name`).
 *  - Sandbox name → the sbx container (`sbx --name`); OPTIONAL. Blank auto-generates
 *    a unique name (no conflicts); picking an existing one switches to "Attach & Resume".
 */
export function LaunchDialog({ definition, existingNames, onLaunch, onAttach, onCancel }: {
  definition: Definition
  existingNames: string[]
  onLaunch: (sandboxName: string, sessionName: string) => void
  onAttach: (sandboxName: string) => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const [sessionName, setSessionName] = useState(definition.name)
  const [sandboxName, setSandboxName] = useState('')
  const trimmed = sandboxName.trim()
  const exists = trimmed.length > 0 && existingNames.includes(trimmed)
  const listId = 'launch-existing-sandboxes'

  function submit(): void {
    if (exists) onAttach(trimmed)
    else onLaunch(trimmed, sessionName.trim())
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('launch.title', { name: definition.name })} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{t('launch.title', { name: definition.name })}</h3>
        <p className="modal-desc">{t('launch.subtitle')}</p>

        <label htmlFor="launch-session" style={labelStyle}>{t('launch.sessionLabel')}</label>
        <input
          id="launch-session"
          aria-label="Session name"
          className="input"
          value={sessionName}
          disabled={exists}
          autoFocus
          onChange={(e) => setSessionName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0 }}>{t('launch.sessionSub')}</p>

        <label htmlFor="launch-sandbox" style={labelStyle}>{t('launch.sandboxLabel')}</label>
        <input
          id="launch-sandbox"
          aria-label="Sandbox name"
          className="input input-mono"
          list={listId}
          value={sandboxName}
          placeholder={t('launch.sandboxPlaceholder')}
          onChange={(e) => setSandboxName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <datalist id={listId}>
          {existingNames.map((n) => <option key={n} value={n} />)}
        </datalist>
        <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0 }}>
          {exists ? t('launch.existsHint', { name: trimmed }) : trimmed ? t('launch.newHint', { name: trimmed }) : t('launch.autoHint')}
        </p>

        <div className="modal-actions" style={{ marginTop: 'var(--space-5)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>{t('launch.cancel')}</button>
          <button className="btn btn-primary" onClick={submit}>
            {exists ? t('launch.attachResume') : t('launch.launchNew')}
          </button>
        </div>
      </div>
    </div>
  )
}
