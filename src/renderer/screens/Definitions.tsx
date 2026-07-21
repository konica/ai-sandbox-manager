import { useState } from 'react'
import type { Definition } from '@shared/types'
import { TierBadge } from '../components/badges'
import { useT } from '../i18n'

function PlusIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function EditIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function LaunchIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  )
}

export function Definitions({ definitions, onCreate, onLaunch, onEdit, onImport, onExport, launchingId, flash }: {
  definitions: Definition[]
  onCreate: () => void
  onLaunch?: (definitionId: string) => void
  onEdit?: (definitionId: string) => void
  onImport?: () => void
  onExport?: (ids: string[]) => void
  launchingId?: string | null
  flash?: { kind: 'info' | 'error'; text: string } | null
}): JSX.Element {
  const t = useT()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const allSelected = definitions.length > 0 && definitions.every((d) => selected.has(d.id))

  function toggle(id: string): void {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(definitions.map((d) => d.id)))
  }

  return (
    <section className="screen active">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title" style={{ marginBottom: 0 }}>{t('definitions.title')}</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-secondary" onClick={() => onImport?.()}>{t('definitions.import')}</button>
          <button className="btn btn-secondary" aria-label={t('definitions.exportSelected')} disabled={selected.size === 0} title={selected.size === 0 ? t('definitions.exportHint') : undefined} onClick={() => onExport?.([...selected])}>{t('definitions.export')}</button>
          <button className="btn btn-primary" onClick={onCreate}><PlusIcon /> {t('common.createSandbox')}</button>
        </div>
      </div>
      <p className="section-desc">{t('definitions.subtitle')}</p>

      {flash && <p className="section-desc" style={{ color: flash.kind === 'error' ? 'var(--danger)' : 'var(--success, var(--accent))', marginBottom: 'var(--space-3)' }}>{flash.text}</p>}

      {definitions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
          <p className="section-desc" style={{ marginBottom: 0 }}>{t('definitions.empty')}</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}><input type="checkbox" aria-label={t('definitions.selectAll')} checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer' }} /></th>
                  <th>{t('definitions.colName')}</th><th>{t('definitions.colBase')}</th><th>{t('definitions.colNetwork')}</th><th>{t('definitions.colCreated')}</th><th>{t('definitions.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {definitions.map((d) => (
                  <tr key={d.id} className={selected.has(d.id) ? 'selected' : undefined}>
                    <td style={{ width: 40, textAlign: 'center' }}><input type="checkbox" aria-label={t('definitions.selectOne', { name: d.name })} checked={selected.has(d.id)} onChange={() => toggle(d.id)} style={{ cursor: 'pointer' }} /></td>
                    <td>
                      <strong style={{ fontSize: 13, fontWeight: 510 }}>{d.name}</strong>
                      {d.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{d.description}</div>}
                    </td>
                    <td><span className="code-inline">{d.baseImage}</span></td>
                    <td><TierBadge tier={d.tier} /></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{d.createdAt.slice(0, 10)}</td>
                    <td>
                      <div className="flex" style={{ gap: 'var(--space-2)', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => onExport?.([d.id])}>{t('definitions.export')}</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => onEdit?.(d.id)}><EditIcon /> {t('definitions.edit')}</button>
                        <button className="btn btn-primary btn-sm" disabled={launchingId === d.id} onClick={() => onLaunch?.(d.id)}><LaunchIcon /> {launchingId === d.id ? t('definitions.launching') : t('definitions.launch')}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected.size > 0 && (
            <div className="selection-bar" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
              <span style={{ fontSize: 13, fontWeight: 510 }}>{t('definitions.selectedCount', { count: selected.size })}</span>
              <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelected(new Set())}>{t('definitions.clearSelection')}</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
