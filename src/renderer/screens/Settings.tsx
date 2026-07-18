import { useT } from '../i18n'

export function Settings(): JSX.Element {
  const t = useT()
  const rows: { label: string; detail: string }[] = [
    { label: t('settings.defaultTier'), detail: t('settings.defaultTierValue') },
    { label: t('settings.credStorage'), detail: t('settings.credStorageValue') },
    { label: t('settings.agent'), detail: t('settings.agentValue') }
  ]
  return (
    <section className="screen active">
      <h2 className="section-title">{t('settings.title')}</h2>
      <p className="section-desc">{t('settings.subtitle')}</p>
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
