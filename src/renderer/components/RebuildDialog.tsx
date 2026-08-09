import { useState } from 'react'
import { useT } from '../i18n'
import { isValidDiskSize } from '@shared/resources'

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: 'var(--space-4) 0 var(--space-2)' } as const

/** Pre-fill precedence for the rebuild disk-size field: the instance's created-with size,
 * else the definition's current default, else blank (= Docker default). */
export function rebuildInitialDiskSize(instanceDiskSize?: string, definitionDiskSize?: string): string {
  return instanceDiskSize ?? definitionDiskSize ?? ''
}

/**
 * Rebuild confirmation with an editable disk size. Rebuild is the only path that recreates
 * the sandbox's volume, so it's the only place an existing instance's disk size can change.
 */
export function RebuildDialog({ name, initialDiskSize, onRebuild, onCancel }: {
  name: string
  initialDiskSize: string
  onRebuild: (diskSize: string) => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const [diskSize, setDiskSize] = useState(initialDiskSize)
  const valid = isValidDiskSize(diskSize)

  function submit(): void {
    if (valid) onRebuild(diskSize.trim())
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('instances.rebuildTitle')} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{t('instances.rebuildTitle')}</h3>
        <p className="modal-desc">{t('instances.rebuildBody', { name })}</p>

        <label htmlFor="rebuild-disk-size" style={labelStyle}>{t('launch.diskSizeLabel')}</label>
        <input
          id="rebuild-disk-size"
          aria-label="Disk size"
          className="input"
          value={diskSize}
          placeholder={t('launch.diskSizePlaceholder')}
          autoFocus
          onChange={(e) => setDiskSize(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        {!valid && <p role="alert" className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0, color: 'var(--danger)' }}>{t('launch.diskSizeInvalid')}</p>}

        <div className="modal-actions" style={{ marginTop: 'var(--space-5)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>{t('instances.cancel')}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={submit}>{t('instances.confirmRebuild')}</button>
        </div>
      </div>
    </div>
  )
}
