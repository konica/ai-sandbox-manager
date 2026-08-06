import { useState } from 'react'
import type { InstanceView } from '@shared/types'
import { TierBadge, StatusBadge } from '../components/badges'
import { useT } from '../i18n'

/** Single-line, width-capped cell content with the full value in a hover tooltip. */
function Truncate({ text, max, mono, tail }: { text: string; max: number; mono?: boolean; tail?: boolean }): JSX.Element {
  return (
    <span
      title={text}
      className={mono ? 'code-inline' : undefined}
      style={{
        display: 'inline-block',
        maxWidth: max,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
        ...(mono ? { fontSize: 11 } : {}),
        // truncate from the left so the meaningful tail (basename) stays visible
        ...(tail ? { direction: 'rtl' as const, textAlign: 'left' as const } : {})
      }}
    >
      {text}
    </span>
  )
}

const dash = <span style={{ color: 'var(--text-muted)' }}>—</span>

export function Instances({ instances, onOpen, onAttach, onShell, onStop, onRemove }: {
  instances: InstanceView[]
  onOpen?: (name: string) => void
  onAttach?: (name: string) => void
  onShell?: (name: string) => void
  onStop?: (name: string) => void
  onRemove?: (name: string) => void
}): JSX.Element {
  const t = useT()
  const [selected, setSelected] = useState<string[]>([])
  const allTags = Array.from(new Set(instances.flatMap((i) => i.tags))).sort((a, b) => a.localeCompare(b))
  const shown = selected.length === 0 ? instances : instances.filter((i) => i.tags.some((tag) => selected.includes(tag)))
  function toggleTag(tag: string): void {
    setSelected((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
  }
  return (
    <section className="screen active">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title" style={{ marginBottom: 0 }}>{t('instances.title')}</h2>
      </div>
      <p className="section-desc">{t('instances.subtitle')}</p>

      {allTags.length > 0 && (
        <div className="tag-filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('instances.filterByTags')}</span>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-label={`Filter tag ${tag}`}
              aria-pressed={selected.includes(tag)}
              className="btn btn-sm"
              style={{ fontSize: 12, borderRadius: 999, background: selected.includes(tag) ? 'var(--accent)' : 'var(--surface)', color: selected.includes(tag) ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
              onClick={() => toggleTag(tag)}
            >{tag}</button>
          ))}
          {selected.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setSelected([])}>{t('instances.filterClear')}</button>
          )}
        </div>
      )}

      {instances.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
          <p className="section-desc" style={{ marginBottom: 0 }}>{t('instances.empty')}</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ whiteSpace: 'nowrap' }}>{t('instances.colName')}</th><th>{t('instances.colStatus')}</th><th>{t('instances.colDefinition')}</th><th>{t('instances.colTags')}</th><th style={{ whiteSpace: 'nowrap' }}>{t('instances.colWorkspace')}</th><th>{t('instances.colAgent')}</th><th>{t('instances.colNetwork')}</th><th>{t('instances.colPorts')}</th><th>{t('instances.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.name}>
                  <td><button className="link-button" style={{ fontSize: 13, fontWeight: 510, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }} onClick={() => onOpen?.(i.name)}><Truncate text={i.name} max={200} /></button></td>
                  <td><StatusBadge status={i.status} /></td>
                  <td>{i.definitionName ? <Truncate text={i.definitionName} max={140} mono /> : dash}</td>
                  <td>
                    {i.tags.length === 0 ? dash : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {i.tags.map((tag) => (
                          <span key={tag} className="tag">{tag}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{i.workspace ? <Truncate text={i.workspace} max={220} mono tail /> : dash}</td>
                  <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{i.agent}</td>
                  <td><TierBadge tier={i.tier} /></td>
                  <td>{i.ports.length ? <Truncate text={i.ports.join(', ')} max={150} mono /> : dash}</td>
                  <td>
                    <div className="flex" style={{ gap: 'var(--space-2)', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => onAttach?.(i.name)}>{t('instances.attach')}</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onShell?.(i.name)}>{t('instances.shell')}</button>
                      <button className="btn btn-secondary btn-sm" disabled={i.status !== 'running'} onClick={() => onStop?.(i.name)}>{t('instances.stop')}</button>
                      <button className="btn btn-destructive btn-sm" onClick={() => onRemove?.(i.name)}>{t('instances.remove')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </section>
  )
}
