import { useState } from 'react'
import type { StorageStatus } from '@shared/types'
import { useT } from '../i18n'

const codeBlock = { margin: '4px 0 0', padding: '6px 8px', background: 'var(--bg, rgba(0,0,0,.25))', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' as const, userSelect: 'text' as const }

/** Read-only guide: where credentials live + this machine's at-rest backend. Not configurable. */
export function CredentialStorageGuide({ status }: { status: StorageStatus | null }): JSX.Element {
  const t = useT()
  const [fixOpen, setFixOpen] = useState(false)
  if (!status) return <></>

  const insecure = !status.secure
  const message = status.platform === 'darwin' ? t('settings.storageMac')
    : status.platform === 'win32' ? t('settings.storageWin')
    : status.secure ? t('settings.storageLinuxSecure')
    : t('settings.storageLinuxInsecure')

  return (
    <div className="card" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <h3 className="section-title" style={{ fontSize: 15, marginBottom: 'var(--space-1)' }}>{t('settings.storageTitle')}</h3>
      <p style={{ margin: 0, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: insecure ? 'var(--danger)' : 'var(--text-secondary)' }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: insecure ? 'var(--danger)' : 'var(--success, #3fb950)' }} />
        {insecure && <span aria-hidden>⚠️ </span>}{message}
      </p>
      <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0 }}>{t('settings.storageExplainer')}</p>

      {insecure && status.platform === 'linux' && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <button aria-expanded={fixOpen} onClick={() => setFixOpen((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span aria-hidden style={{ transform: fixOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
            {t('settings.storageFixToggle')}
          </button>
          {fixOpen && (
            <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)' }}>
              <p style={{ margin: 0 }}>{t('settings.storageFixStep1')}</p>
              <pre style={codeBlock}>{'# Debian/Ubuntu\nsudo apt-get install -y gnome-keyring\n\n# Fedora\nsudo dnf install -y gnome-keyring'}</pre>
              <p style={{ margin: '8px 0 0' }}>{t('settings.storageFixStep2')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
