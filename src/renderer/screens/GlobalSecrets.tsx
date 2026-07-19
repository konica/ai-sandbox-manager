import { useState } from 'react'
import type { GlobalSecretMeta } from '@shared/types'
import { KNOWN_SERVICES } from '@shared/services'
import { useT } from '../i18n'

/**
 * Manage reusable global secrets (sbx `secret set -g`). Presentational — Settings
 * owns the data (list/add/remove via IPC). Values are entered here but never returned.
 */
export function GlobalSecrets({ secrets, onAdd, onRemove }: {
  secrets: GlobalSecretMeta[]
  onAdd: (serviceId: string, value: string) => void
  onRemove: (id: string) => void
}): JSX.Element {
  const t = useT()
  const [serviceId, setServiceId] = useState(KNOWN_SERVICES[0].id)
  const [value, setValue] = useState('')

  function add(): void {
    if (!value.trim()) return
    onAdd(serviceId, value.trim())
    setValue('')
  }

  return (
    <div className="card" style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)' }}>
      <h3 className="section-title" style={{ fontSize: 15, marginBottom: 'var(--space-1)' }}>{t('secrets.title')}</h3>
      <p className="section-desc" style={{ marginTop: 0 }}>{t('secrets.subtitle')}</p>

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <select aria-label="Service" className="input" style={{ flex: '1 1 260px' }} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {KNOWN_SERVICES.map((s) => (<option key={s.id} value={s.id}>{s.label} — {s.envVars[0]}</option>))}
        </select>
        <input aria-label="Value" type="password" className="input" style={{ flex: '1 1 180px' }} placeholder="sk-…" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={add}>{t('secrets.add')}</button>
      </div>

      {secrets.length === 0
        ? <p className="section-desc" style={{ margin: 0, fontSize: 12 }}>{t('secrets.none')}</p>
        : secrets.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }}>
            <span style={{ fontSize: 13 }}>{s.label} <span className="code-inline">{s.envVar}</span> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>•••</span></span>
            <button className="btn btn-ghost btn-sm" aria-label="Remove" onClick={() => onRemove(s.id)}>{t('secrets.remove')}</button>
          </div>
        ))}
    </div>
  )
}
