import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { api } from '../../ipc/client'
import { useT } from '../../i18n'
import type { ArchiveEntry } from '@shared/session'

/** Most recent backups worth offering; older ones are pruned on the main side anyway. */
const SHOWN = 3

/**
 * The Claude session backups a rebuild has taken for this instance's definition, each
 * exportable to a folder of the user's choosing.
 *
 * Renders NOTHING when there are no backups (or the list cannot be read) rather than an
 * empty-state box: instances that never had sessions should look exactly as they did before
 * this feature existed.
 */
export function SessionBackups({ name }: { name: string }): JSX.Element | null {
  const t = useT()
  const [archives, setArchives] = useState<ArchiveEntry[]>([])
  const [savedTo, setSavedTo] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setSavedTo(null)
    void api.sessionListArchives(name).then((r) => {
      if (live) setArchives(r.ok ? r.data.slice(0, SHOWN) : [])
    })
    return () => { live = false }
  }, [name])

  if (archives.length === 0) return null

  async function onExport(dir: string): Promise<void> {
    const res = await api.sessionExportArchive(dir)
    // A cancelled picker is not a failure and must not report a destination.
    if (res.ok && res.data.path) setSavedTo(res.data.path)
  }

  return (
    <div className="card" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 'var(--space-2)' }}>{t('detail.sessionBackups')}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 'var(--space-3)' }}>{t('detail.sessionBackupsHint')}</div>
      {archives.map((a) => (
        <div key={a.dir} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
          <span style={{ fontSize: 13, flex: 1 }}>
            <span className="code-inline">{a.sbxName}</span>{' · '}{new Date(a.capturedAt).toLocaleString()}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => void onExport(a.dir)}>{t('detail.sessionBackupExport')}</button>
        </div>
      ))}
      {savedTo && (
        <div role="status" style={{ fontSize: 12, marginTop: 'var(--space-3)' }}>
          {t('detail.sessionBackupSaved')} <span className="code-inline">{savedTo}</span>
        </div>
      )}
    </div>
  )
}
