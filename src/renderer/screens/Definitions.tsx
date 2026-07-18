import type { Definition } from '@shared/types'
import { TierBadge } from '../components/badges'

function PlusIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function Definitions({ definitions, onCreate }: { definitions: Definition[]; onCreate: () => void }): JSX.Element {
  return (
    <section className="screen active">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title" style={{ marginBottom: 0 }}>Sandbox Definitions</h2>
        <button className="btn btn-primary" onClick={onCreate}><PlusIcon /> Create Sandbox</button>
      </div>
      <p className="section-desc">
        Sandbox definitions are reusable specs that describe an environment. Each definition can launch multiple runtime instances.
      </p>

      {definitions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
          <p className="section-desc" style={{ marginBottom: 0 }}>No definitions yet. Create one to describe a reusable sandbox environment.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>Base Image</th><th>Network</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {definitions.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong style={{ fontSize: 13, fontWeight: 510 }}>{d.name}</strong>
                    {d.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{d.description}</div>}
                  </td>
                  <td><span className="code-inline">{d.baseImage}</span></td>
                  <td><TierBadge tier={d.tier} /></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{d.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
