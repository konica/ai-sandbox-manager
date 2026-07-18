import type { InstanceView } from '@shared/types'

export function Instances({ instances }: { instances: InstanceView[] }): JSX.Element {
  if (instances.length === 0) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <h1>Instances</h1>
        <p style={{ color: 'var(--muted)' }}>No sandboxes yet. Create a definition and launch an instance to get started.</p>
      </div>
    )
  }
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Instances</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
            <th>Instance</th><th>Status</th><th>Definition</th><th>Workspace</th><th>Agent</th><th>Network</th><th>Ports</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((i) => (
            <tr key={i.name} style={{ borderTop: '1px solid var(--border)' }}>
              <td>{i.name}</td>
              <td>{i.status}</td>
              <td>{i.definitionName ?? '—'}</td>
              <td>{i.workspace ?? '—'}</td>
              <td>{i.agent}</td>
              <td>{i.tier}</td>
              <td>{i.ports.length ? i.ports.join(', ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
