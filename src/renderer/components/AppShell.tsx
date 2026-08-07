import { useEffect, useState, type ReactNode } from 'react'
import { useI18n, LANG_NAMES, type Lang } from '../i18n'
import { api } from '../ipc/client'
import iconUrl from '../../../build/icon.png'

export type NavScreen = 'prereq' | 'definitions' | 'instances' | 'settings'

// Injected from package.json at build time (electron.vite.config.ts `define`).
// Guarded so it also resolves under Vitest, where the define isn't applied.
declare const __APP_VERSION__: string
const APP_VERSION = 'v' + (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0')
const APP_AUTHOR = 'Trung Thảo'

function ThemeToggle({ title }: { title: string }): JSX.Element {
  const [light, setLight] = useState(false)

  useEffect(() => {
    let isLight = false
    try { isLight = localStorage.getItem('sbx-theme') === 'light' } catch { /* ignore */ }
    document.body.classList.toggle('theme-light', isLight)
    setLight(isLight)
    api.setTitleBarOverlay?.(isLight)
  }, [])

  function toggle(): void {
    const next = !light
    document.body.classList.toggle('theme-light', next)
    try { localStorage.setItem('sbx-theme', next ? 'light' : 'dark') } catch { /* ignore */ }
    setLight(next)
    api.setTitleBarOverlay?.(next)
  }

  return (
    <button className="theme-toggle" onClick={toggle} title={title} aria-label={title}>
      {light ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}

function LanguageSwitcher(): JSX.Element {
  const { lang, setLang, t } = useI18n()
  const langs: Lang[] = ['en', 'de']
  return (
    <select
      className="input"
      aria-label={t('titlebar.language')}
      title={t('titlebar.language')}
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      style={{ width: 'auto', padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
    >
      {langs.map((l) => (<option key={l} value={l}>{l.toUpperCase()} · {LANG_NAMES[l]}</option>))}
    </select>
  )
}

function NavIcon({ screen }: { screen: NavScreen }): JSX.Element {
  const common = { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (screen) {
    case 'prereq':
      return <svg {...common}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
    case 'definitions':
      return <svg {...common}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
    case 'instances':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
  }
}

interface NavItemDef { screen: NavScreen; label: string; badge?: number }

export function AppShell({
  active,
  onNavigate,
  defCount,
  instanceCount,
  children
}: {
  active: NavScreen
  onNavigate: (s: NavScreen) => void
  defCount: number
  instanceCount: number
  children: ReactNode
}): JSX.Element {
  const { t } = useI18n()
  const items: NavItemDef[] = [
    { screen: 'prereq', label: t('nav.prerequisites') },
    { screen: 'definitions', label: t('nav.definitions'), badge: defCount },
    { screen: 'instances', label: t('nav.instances'), badge: instanceCount },
    { screen: 'settings', label: t('nav.settings') }
  ]

  return (
    <div className="app-shell">
      <div className="titlebar">
        <div className="titlebar-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <img src={iconUrl} alt="" width={20} height={20} style={{ borderRadius: 4, display: 'block' }} />
          AI Sandbox Manager
        </div>
        <div className="titlebar-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <LanguageSwitcher />
          <ThemeToggle title={t('titlebar.toggleTheme')} />
        </div>
      </div>
      <div className="app-body">
        <aside className="sidebar">
          <nav className="sidebar-nav" style={{ paddingTop: 'var(--space-3)' }}>
            {items.map((it) => (
              <button
                key={it.screen}
                className={`nav-item${active === it.screen ? ' active' : ''}`}
                onClick={() => onNavigate(it.screen)}
              >
                <NavIcon screen={it.screen} />
                {it.label}
                {it.badge !== undefined && it.badge > 0 && <span className="nav-badge">{it.badge}</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className="version">{APP_VERSION}</span>
            <span className="footer-author">{APP_AUTHOR}</span>
          </div>
        </aside>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
