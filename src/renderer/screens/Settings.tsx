import { useCallback, useEffect, useState } from 'react'
import type { GlobalSecretMeta } from '@shared/types'
import { api } from '../ipc/client'
import { useT } from '../i18n'
import { GlobalSecrets } from './GlobalSecrets'

export function Settings(): JSX.Element {
  const t = useT()
  const [secrets, setSecrets] = useState<GlobalSecretMeta[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api.secretListGlobal()
    if (r.ok) setSecrets(r.data)
  }, [])
  useEffect(() => { void load() }, [load])

  async function onAdd(serviceId: string, value: string): Promise<void> {
    setNotice(null)
    const r = await api.secretSetGlobal(serviceId, value)
    if (r.ok) await load()
    else setNotice(r.error.message)
  }
  async function onRemove(id: string): Promise<void> {
    setNotice(null)
    const r = await api.secretRemoveGlobal(id)
    if (r.ok) await load()
    else setNotice(r.error.message)
  }

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
      {notice && <p className="section-desc" style={{ color: 'var(--danger)', marginTop: 'var(--space-3)' }}>{notice}</p>}
      <GlobalSecrets secrets={secrets} onAdd={(id, v) => void onAdd(id, v)} onRemove={(id) => void onRemove(id)} />
    </section>
  )
}
