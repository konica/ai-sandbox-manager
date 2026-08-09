import { useState } from 'react'
import type { Definition } from '@shared/types'
import { isValidDiskSize } from '@shared/resources'
import { useT } from '../i18n'
import { TagInput } from './TagInput'

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: 'var(--space-4) 0 var(--space-2)' } as const

/**
 * Launch dialog. The sbx sandbox name is always auto-generated (unique), so the
 * only input is an optional Session name → the Claude Code session display name
 * (`claude --name`). Re-attaching to an existing sandbox is done from the
 * Instances screen, not here.
 */
export function LaunchDialog({ definition, hasVSCode, cloneMode, willSkipFixedPorts, instanceNumber, onLaunch, onCancel }: {
  definition: Definition
  hasVSCode: boolean
  cloneMode: boolean
  willSkipFixedPorts: boolean
  instanceNumber: number
  onLaunch: (sessionName: string, opener: 'terminal' | 'vscode', tags: string[], diskSize: string) => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const [sessionName, setSessionName] = useState('')
  // Default to VS Code when it's available; fall back to Terminal when the code
  // CLI wasn't detected (the VS Code radio is disabled in that case).
  const [opener, setOpener] = useState<'terminal' | 'vscode'>(hasVSCode ? 'vscode' : 'terminal')
  const [tags, setTags] = useState<string[]>([])
  const [diskSize, setDiskSize] = useState(definition.diskSize ?? '')

  function submit(): void {
    onLaunch(sessionName.trim(), opener, tags, diskSize.trim())
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
          placeholder={t('launch.sessionPlaceholder')}
          autoFocus
          onChange={(e) => setSessionName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0 }}>{t('launch.sessionSub')}</p>

        <label style={labelStyle}>{t('launch.tagsLabel')}</label>
        <TagInput tags={tags} onChange={setTags} placeholder={t('launch.tagsPlaceholder')} ariaLabel="Instance tags" />
        <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0 }}>{t('launch.tagsSub')}</p>

        <label htmlFor="launch-disk-size" style={labelStyle}>{t('launch.diskSizeLabel')}</label>
        <input
          id="launch-disk-size"
          aria-label="Disk size"
          className="input"
          value={diskSize}
          placeholder={t('launch.diskSizePlaceholder')}
          onChange={(e) => setDiskSize(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && isValidDiskSize(diskSize)) submit() }}
        />
        {!isValidDiskSize(diskSize) && <p role="alert" className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0, color: 'var(--danger)' }}>{t('launch.diskSizeInvalid')}</p>}
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
