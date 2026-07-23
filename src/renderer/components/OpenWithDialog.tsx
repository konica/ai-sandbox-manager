import { useState } from 'react'
import { useT } from '../i18n'

/**
 * Minimal opener chooser for attach / open-agent-session. VS Code is the primary
 * (default) action when the `code` CLI is available; otherwise Terminal is primary
 * and VS Code is disabled. Reuses the launch.* i18n keys.
 */
export function OpenWithDialog({ title, hasVSCode, onChoose, onCancel }: {
  title: string
  hasVSCode: boolean
  onChoose: (opener: 'terminal' | 'vscode', yolo: boolean) => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const [yolo, setYolo] = useState(true)
  // The primary (rightmost, emphasised) button is the default opener: VS Code when
  // available, Terminal otherwise.
  const terminalBtn = <button className={`btn ${hasVSCode ? 'btn-secondary' : 'btn-primary'}`} onClick={() => onChoose('terminal', yolo)}>{t('launch.openTerminal')}</button>
  const vscodeBtn = <button className={`btn ${hasVSCode ? 'btn-primary' : 'btn-secondary'}`} disabled={!hasVSCode} onClick={() => onChoose('vscode', yolo)}>{t('launch.openVSCode')}</button>
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 'var(--space-3)' }}>
          <input type="checkbox" aria-label="Yolo mode" checked={yolo} onChange={(e) => setYolo(e.target.checked)} />
          {t('launch.yoloLabel')}
          <span className="info-dot" tabIndex={0} role="img" aria-label={t('launch.yoloHint')} title={t('launch.yoloHint')}>ⓘ</span>
        </label>
        <div className="modal-actions" style={{ marginTop: 'var(--space-4)', gap: 'var(--space-2)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>{t('launch.cancel')}</button>
          {hasVSCode ? <>{terminalBtn}{vscodeBtn}</> : <>{vscodeBtn}{terminalBtn}</>}
        </div>
        {!hasVSCode && <p className="section-desc" style={{ fontSize: 11, margin: '8px 0 0' }}>{t('launch.openVSCodeUnavailable')}</p>}
      </div>
    </div>
  )
}
