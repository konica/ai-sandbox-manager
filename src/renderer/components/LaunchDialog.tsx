import { useState } from 'react'
import type { Definition } from '@shared/types'
import { useT } from '../i18n'
import { TagInput } from './TagInput'

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: 'var(--space-4) 0 var(--space-2)' } as const

/**
 * Launch dialog. The sbx sandbox name is always auto-generated (unique) and sessions are
 * named inside the agent's own session view, so the only inputs are tags and the opener.
 * Re-attaching to an existing sandbox is done from the Instances screen, not here.
 */
export function LaunchDialog({ definition, hasVSCode, cloneMode, willSkipFixedPorts, instanceNumber, onLaunch, onCancel }: {
  definition: Definition
  hasVSCode: boolean
  cloneMode: boolean
  willSkipFixedPorts: boolean
  instanceNumber: number
  onLaunch: (opener: 'terminal' | 'vscode', tags: string[]) => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  // Default to VS Code when it's available; fall back to Terminal when the code
  // CLI wasn't detected (the VS Code radio is disabled in that case).
  const [opener, setOpener] = useState<'terminal' | 'vscode'>(hasVSCode ? 'vscode' : 'terminal')
  const [tags, setTags] = useState<string[]>([])

  function submit(): void {
    onLaunch(opener, tags)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('launch.title', { name: definition.name })} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{t('launch.title', { name: definition.name })}</h3>
        <p className="modal-desc">{t('launch.subtitle')}</p>

        <label style={labelStyle}>{t('launch.tagsLabel')}</label>
        <TagInput tags={tags} onChange={setTags} placeholder={t('launch.tagsPlaceholder')} ariaLabel="Instance tags" />
        <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0 }}>{t('launch.tagsSub')}</p>
        {willSkipFixedPorts && (
          <p role="note" className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-3)', color: 'var(--warning, #b8860b)' }}>
            {t('launch.portSkipNote', { number: instanceNumber })}
          </p>
        )}

        <label style={labelStyle}>{t('launch.openWith')}</label>
        <div role="radiogroup" style={{ display: 'flex', gap: 'var(--space-4)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="radio" aria-label="Terminal" name="opener" checked={opener === 'terminal'} onChange={() => setOpener('terminal')} />
            {t('launch.openTerminal')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: hasVSCode ? 1 : 0.5 }}>
            <input type="radio" aria-label="VS Code" name="opener" disabled={!hasVSCode} checked={opener === 'vscode'} onChange={() => setOpener('vscode')} />
            {t('launch.openVSCode')}
          </label>
        </div>
        {!hasVSCode && <p className="section-desc" style={{ fontSize: 11, margin: '4px 0 0' }}>{t('launch.openVSCodeUnavailable')}</p>}
        {opener === 'vscode' && cloneMode && <p className="section-desc" style={{ fontSize: 11, margin: '4px 0 0' }}>{t('launch.openVSCodeCloneNote')}</p>}

        <div className="modal-actions" style={{ marginTop: 'var(--space-5)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>{t('launch.cancel')}</button>
          <button className="btn btn-primary" onClick={submit}>{t('launch.launch')}</button>
        </div>
      </div>
    </div>
  )
}
