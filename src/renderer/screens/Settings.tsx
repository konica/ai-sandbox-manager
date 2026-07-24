import { useCallback, useEffect, useState } from 'react'
import type { GlobalSecretMeta, Tier } from '@shared/types'
import { api } from '../ipc/client'
import { useT } from '../i18n'
import { GlobalSecrets } from './GlobalSecrets'
import { AccountsSection } from './AccountsSection'

const TIERS: Tier[] = ['open', 'balanced', 'locked']
function isTier(v: string | null): v is Tier { return v === 'open' || v === 'balanced' || v === 'locked' }

export function Settings(): JSX.Element {
  const t = useT()
  const [secrets, setSecrets] = useState<GlobalSecretMeta[]>([])
  const [tier, setTier] = useState<Tier>('locked')
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api.secretListGlobal()
    if (r.ok) setSecrets(r.data)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { void api.prefsGet('defaultTier').then((r) => { if (r.ok && isTier(r.data)) setTier(r.data) }) }, [])

  async function onTier(next: Tier): Promise<void> {
    setTier(next)
    const r = await api.prefsSet('defaultTier', next)
    if (!r.ok) setNotice(r.error.message)
  }
  async function onAdd(serviceId: string, value: string): Promise<void> {
    setNotice(null)
    const r = await api.secretSetGlobal(serviceId, value)
    if (r.ok) await load(); else setNotice(r.error.message)
  }
  async function onRemove(id: string): Promise<void> {
    setNotice(null)
    const r = await api.secretRemoveGlobal(id)
    if (r.ok) await load(); else setNotice(r.error.message)
  }

  return (
    <section className="screen active">
      <h2 className="section-title">{t('settings.title')}</h2>
      <p className="section-desc">{t('settings.subtitle')}</p>

      <div className="card" style={{ padding: 'var(--space-4)' }}>
        <h3 className="section-title" style={{ fontSize: 15, marginBottom: 'var(--space-1)' }}>{t('settings.defaultTier')}</h3>
        <p className="section-desc" style={{ marginTop: 0 }}>{t('settings.defaultTierHint')}</p>
        <div role="group" aria-label={t('settings.defaultTier')} style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {TIERS.map((tr) => (
            <button
              key={tr}
              type="button"
              aria-pressed={tier === tr}
              className={`btn btn-sm ${tier === tr ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => void onTier(tr)}
            >
              {t(`tier.${tr}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 'var(--space-4)', padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <tbody>
            <tr>
              <td style={{ color: 'var(--text-secondary)', width: '40%' }}>{t('settings.credStorage')}</td>
              <td>{t('settings.credStorageValue')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {notice && <p className="section-desc" style={{ color: 'var(--danger)', marginTop: 'var(--space-3)' }}>{notice}</p>}
      <GlobalSecrets secrets={secrets} onAdd={(id, v) => void onAdd(id, v)} onRemove={(id) => void onRemove(id)} />
      <AccountsSection />
    </section>
  )
}
