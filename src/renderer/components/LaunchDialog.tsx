import { useState } from 'react'
import type { Definition } from '@shared/types'
import { toSbxName } from '@shared/names'
import { useT } from '../i18n'

/**
 * Launch dialog: name the new session, or type/pick an existing sandbox name to
 * reconnect. When the name matches an existing sandbox the primary action becomes
 * "Attach & Resume"; otherwise "Launch new".
 */
export function LaunchDialog({ definition, existingNames, onLaunch, onAttach, onCancel }: {
  definition: Definition
  existingNames: string[]
  onLaunch: (name: string) => void
  onAttach: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const [name, setName] = useState(() => toSbxName(definition.name))
  const trimmed = name.trim()
  const exists = existingNames.includes(trimmed)
  const canSubmit = trimmed.length > 0
  const listId = 'launch-existing-sandboxes'

  function submit(): void {
    if (!canSubmit) return
    if (exists) onAttach(trimmed)
    else onLaunch(trimmed)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('launch.title', { name: definition.name })} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{t('launch.title', { name: definition.name })}</h3>
        <p className="modal-desc">{t('launch.subtitle')}</p>

        <label htmlFor="launch-name" style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: 'var(--space-4) 0 var(--space-2)' }}>
          {t('launch.nameLabel')}
        </label>
        <input
          id="launch-name"
          aria-label="Session name"
          className="input input-mono"
          list={listId}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <datalist id={listId}>
          {existingNames.map((n) => <option key={n} value={n} />)}
        </datalist>

        <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0 }}>
          {!canSubmit ? t('launch.empty') : exists ? t('launch.existsHint', { name: trimmed }) : t('launch.newHint', { name: trimmed })}
        </p>

        <div className="modal-actions" style={{ marginTop: 'var(--space-5)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>{t('launch.cancel')}</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
            {exists ? t('launch.attachResume') : t('launch.launchNew')}
          </button>
        </div>
      </div>
    </div>
  )
}
