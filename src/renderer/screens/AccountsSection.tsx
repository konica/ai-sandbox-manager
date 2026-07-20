import { useCallback, useEffect, useState } from 'react'
import type { ClaudeAuthKind } from '@shared/types'
import { api } from '../ipc/client'
import { useT } from '../i18n'

/**
 * Settings → Accounts: one-time host-side Claude OAuth sign-in. Shows the current
 * auth state (OAuth / API key / none) and opens a terminal for `/login`. Re-checks
 * on window focus so the pill updates after the user finishes signing in.
 */
export function AccountsSection(): JSX.Element {
  const t = useT()
  const [kind, setKind] = useState<ClaudeAuthKind>('none')
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api.authStatus()
    if (r.ok) setKind(r.data.anthropic)
  }, [])
  useEffect(() => {
    void load()
    const onFocus = (): void => { void load() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const label = kind === 'oauth' ? t('settings.accountSignedInOauth') : kind === 'apikey' ? t('settings.accountSignedInKey') : t('settings.accountSignedOut')

  async function signIn(): Promise<void> {
    setNotice(t('settings.accountSignInHint'))
    const r = await api.authStartLogin()
    if (!r.ok) setNotice(r.error.message)
  }
  async function signOut(): Promise<void> {
    const r = await api.authSignOut()
    if (r.ok) await load(); else setNotice(r.error.message)
  }

  return (
    <div style={{ marginTop: 'var(--space-5)' }}>
      <h3 className="section-title" style={{ fontSize: 15 }}>{t('settings.accountsTitle')}</h3>
      <p className="section-desc">{t('settings.accountsSubtitle')}</p>
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span>
          <strong>{t('settings.accountClaude')}</strong>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
        </span>
        {kind === 'none'
          ? <button className="btn btn-primary btn-sm" onClick={() => void signIn()}>{t('settings.accountSignIn')}</button>
          : <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => void signOut()}>{t('settings.accountSignOut')}</button>}
      </div>
      {notice && <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)' }}>{notice}</p>}
    </div>
  )
}
