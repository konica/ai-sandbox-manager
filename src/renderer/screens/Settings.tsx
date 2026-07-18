export function Settings(): JSX.Element {
  const rows: { label: string; detail: string }[] = [
    { label: 'Default network tier', detail: 'Locked Down' },
    { label: 'Credential storage', detail: 'OS keychain, with an encrypted fallback' },
    { label: 'Agent', detail: 'Claude Code' }
  ]
  return (
    <section className="screen active">
      <h2 className="section-title">Settings</h2>
      <p className="section-desc">Application defaults for new sandbox definitions and instances.</p>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={{ color: 'var(--text-secondary)', width: '40%' }}>{r.label}</td>
                <td>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
