import { useState } from 'react'
import type { GlobalSecretMeta } from '@shared/types'
import { KNOWN_SERVICES } from '@shared/services'
import { useT } from '../i18n'

type EnvHit = { serviceId: string; label: string; envVar: string; masked: string }

/**
 * Manage reusable global secrets (sbx `secret set -g`). Presentational — Settings owns the
 * data (list/add/remove/import via IPC). Values are entered/imported here but never returned.
 */
export function GlobalSecrets({ secrets, envHits, onAdd, onRemove, onImport }: {
  secrets: GlobalSecretMeta[]
  envHits: EnvHit[]
  onAdd: (serviceId: string, value: string) => void
  onRemove: (id: string) => void
  onImport: (serviceId: string) => void
}): JSX.Element {
  const t = useT()
  const [serviceId, setServiceId] = useState(KNOWN_SERVICES[0].id)
  const [value, setValue] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function add(): void {
    if (!value.trim()) return
    onAdd(serviceId, value.trim())
    setValue('')
  }
  function toggleSel(id: string): void {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function importSelected(): void {
    for (const id of selected) onImport(id)
    setSelected(new Set()); setImportOpen(false)
  }
  // Only offer to import services not already stored globally.
  const stored = new Set(secrets.map((s) => s.id))
  const importable = envHits.filter((h) => !stored.has(h.serviceId))

  return (
    <div className="card" style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)' }}>
      <h3 className="section-title" style={{ fontSize: 15, marginBottom: 'var(--space-1)' }}>{t('secrets.title')}</h3>
      <p className="section-desc" style={{ marginTop: 0 }}>{t('secrets.subtitle')}</p>

      {/* Import from environment (collapsible, collapsed by default) */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', margin: 'var(--space-3) 0', overflow: 'hidden' }}>
        <button
          aria-expanded={importOpen}
          onClick={() => setImportOpen((v) => !v)}
          style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: 'none', cursor: 'pointer' }}
        >
          <span aria-hidden style={{ color: 'var(--accent)' }}>→</span>
          <span style={{ flex: '1 1 auto' }}>
            <strong style={{ fontSize: 13 }}>{t('secrets.importTitle')}</strong>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> · {t('secrets.importSubtitle')}</span>
          </span>
          <span aria-hidden style={{ transform: importOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
        </button>
        {importOpen && (
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
            {importable.length === 0
              ? <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{t('secrets.importNone')}</p>
              : (
                <>
                  {importable.map((h) => (
                    <label key={h.serviceId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selected.has(h.serviceId)} onChange={() => toggleSel(h.serviceId)} />
                      <span>{h.label} <span className="code-inline">{h.envVar}</span> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.masked}</span></span>
                    </label>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <button className="btn btn-primary btn-sm" disabled={selected.size === 0} onClick={importSelected}>{t('secrets.importSelected')}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(new Set()); setImportOpen(false) }}>{t('secrets.importCancel')}</button>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selected.size} {t('secrets.selected')}</span>
                  </div>
                </>
              )}
          </div>
        )}
      </div>

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
