import { useT } from '../i18n'

/**
 * Minimal opener chooser for attach / open-agent-session. Terminal is primary; VS Code
 * is disabled when the `code` CLI isn't available. Reuses the launch.* i18n keys.
 */
export function OpenWithDialog({ title, hasVSCode, onChoose, onCancel }: {
  title: string
  hasVSCode: boolean
  onChoose: (opener: 'terminal' | 'vscode') => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <div className="modal-actions" style={{ marginTop: 'var(--space-4)', gap: 'var(--space-2)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>{t('launch.cancel')}</button>
          <button className="btn btn-secondary" disabled={!hasVSCode} onClick={() => onChoose('vscode')}>{t('launch.openVSCode')}</button>
          <button className="btn btn-primary" onClick={() => onChoose('terminal')}>{t('launch.openTerminal')}</button>
        </div>
        {!hasVSCode && <p className="section-desc" style={{ fontSize: 11, margin: '8px 0 0' }}>{t('launch.openVSCodeUnavailable')}</p>}
      </div>
    </div>
  )
}
