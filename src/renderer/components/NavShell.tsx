import type { ReactNode } from 'react'

type Screen = 'definitions' | 'instances'

export function NavShell({ active, onNavigate, children }: { active: Screen; onNavigate: (s: Screen) => void; children: ReactNode }): JSX.Element {
  const item = (id: Screen, label: string): JSX.Element => (
    <button
      onClick={() => onNavigate(id)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: 'var(--space-3)',
        background: active === id ? 'var(--surface)' : 'transparent',
        color: active === id ? 'var(--accent)' : 'var(--fg)', border: 'none', cursor: 'pointer'
      }}
    >{label}</button>
  )
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 200, borderRight: '1px solid var(--border)', padding: 'var(--space-3)' }}>
        {item('definitions', 'Definitions')}
        {item('instances', 'Instances')}
      </nav>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  )
}
