import type { InstanceView } from '@shared/types'
import { TierBadge, StatusBadge } from '../components/badges'
import { useT } from '../i18n'

export function Instances({ instances, onAttach, onShell, onStop, onRemove }: {
  instances: InstanceView[]
  onAttach?: (name: string) => void
  onShell?: (name: string) => void
  onStop?: (name: string) => void
  onRemove?: (name: string) => void
}): JSX.Element {
  const t = useT()
  return (
    <section className="screen active">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title" style={{ marginBottom: 0 }}>{t('instances.title')}</h2>
      </div>
      <p className="section-desc">{t('instances.subtitle')}</p>

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
                <th style={{ whiteSpace: 'nowrap' }}>{t('instances.colName')}</th><th>{t('instances.colStatus')}</th><th>{t('instances.colDefinition')}</th><th style={{ whiteSpace: 'nowrap' }}>{t('instances.colWorkspace')}</th><th>{t('instances.colAgent')}</th><th>{t('instances.colNetwork')}</th><th>{t('instances.colPorts')}</th><th>{t('instances.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i.name}>
                  <td><strong style={{ fontSize: 13, fontWeight: 510, whiteSpace: 'nowrap' }}>{i.name}</strong></td>
                  <td><StatusBadge status={i.status} /></td>
                  <td>{i.definitionName ? <span className="code-inline" style={{ fontSize: 11 }}>{i.definitionName}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>{i.workspace
                    ? <span
                        className="code-inline"
                        title={i.workspace}
                        style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle', direction: 'rtl', textAlign: 'left' }}
                      >{i.workspace}</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{i.agent}</td>
                  <td><TierBadge tier={i.tier} /></td>
                  <td>{i.ports.length ? <span className="code-inline" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{i.ports.join(', ')}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>
                    <div className="flex" style={{ gap: 'var(--space-2)', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => onAttach?.(i.name)}>{t('instances.attach')}</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onShell?.(i.name)}>{t('instances.shell')}</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onStop?.(i.name)}>{t('instances.stop')}</button>
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
