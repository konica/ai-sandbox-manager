import type { InstanceView } from '@shared/types'
import { TierBadge, StatusBadge } from '../components/badges'

export function Instances({ instances }: { instances: InstanceView[] }): JSX.Element {
  return (
    <section className="screen active">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title" style={{ marginBottom: 0 }}>Instances</h2>
      </div>
      <p className="section-desc">
        Runtime instances created from sandbox definitions. Each instance runs as an isolated Docker Sandbox.
      </p>

      {instances.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
          <p className="section-desc" style={{ marginBottom: 0 }}>No sandboxes yet. Create a definition and launch an instance to get started.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Instance Name</th><th>Status</th><th>Definition</th><th>Workspace</th><th>Agent</th><th>Network</th><th>Ports</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i.name}>
                  <td><strong style={{ fontSize: 13, fontWeight: 510 }}>{i.name}</strong></td>
                  <td><StatusBadge status={i.status} /></td>
                  <td>{i.definitionName ? <span className="code-inline" style={{ fontSize: 11 }}>{i.definitionName}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>{i.workspace ? <span className="code-inline">{i.workspace}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{i.agent}</td>
                  <td><TierBadge tier={i.tier} /></td>
                  <td>{i.ports.length ? <span className="code-inline" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{i.ports.join(', ')}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
