import type { Definition } from '@shared/types'

export function Definitions({ definitions, onCreate }: { definitions: Definition[]; onCreate: () => void }): JSX.Element {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Sandbox Definitions</h1>
        <button onClick={onCreate}>Create Definition</button>
      </div>
      {definitions.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No definitions yet. Create one to describe a reusable sandbox environment.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th>Name</th><th>Base image</th><th>Network</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td>{d.name}</td>
                <td>{d.baseImage}</td>
                <td>{d.tier}</td>
                <td>{d.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
