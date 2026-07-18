import type { PrereqResult } from '@shared/types'

export function Prereq({ result, onRecheck }: { result: PrereqResult; onRecheck: () => void }): JSX.Element {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>System Prerequisites</h1>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {result.checks.map((c) => (
          <li key={c.id} style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: c.ok ? 'var(--ok)' : 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
              {c.ok ? '✓' : '✕'}
            </span>{' '}
            <strong>{c.label}</strong> — <span style={{ color: 'var(--muted)' }}>{c.detail}</span>
            {!c.ok && c.remediation && (
              <div style={{ color: 'var(--muted)', marginTop: 'var(--space-2)' }}>{c.remediation}</div>
            )}
          </li>
        ))}
      </ul>
      <button onClick={onRecheck}>Re-check</button>
    </div>
  )
}
