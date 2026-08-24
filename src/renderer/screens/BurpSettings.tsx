import { useCallback, useEffect, useState } from 'react'
import type { BurpSettings as Settings } from '@shared/capture'
import { api } from '../ipc/client'
import { useT } from '../i18n'

/** A union, so it must be a type alias — `interface` cannot express one. */
type CaState = { ok: true; name: string; expires: string } | { ok: false; message: string }

/**
 * Settings card for Burp traffic capture. Only two fields genuinely vary — the CA path and
 * Burp's port — so the upstream port sits under Advanced and the two in-sandbox ports are
 * chosen dynamically at enable time rather than configured.
 */
export function BurpSettings(): JSX.Element {
  const t = useT()
  const [settings, setSettings] = useState<Settings>({ caPath: '', proxyPort: 8080, upstreamPort: 3128 })
  const [ca, setCa] = useState<CaState | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const inspect = useCallback(async (path: string) => {
    if (!path) { setCa(null); return }
    const r = await api.captureCaInspect(path)
    setCa(r.ok ? { ok: true, name: r.data.commonName, expires: r.data.expires } : { ok: false, message: r.error.message })
  }, [])

  useEffect(() => {
    void api.captureSettingsGet().then((r) => {
      if (!r.ok) return
      setSettings(r.data)
      void inspect(r.data.caPath)
    })
  }, [inspect])

  async function save(patch: Partial<Settings>): Promise<void> {
    setNotice(null)
    const r = await api.captureSettingsSet(patch)
    if (r.ok) setSettings(r.data); else setNotice(r.error.message)
  }

  async function onBrowse(): Promise<void> {
    const path = await api.pickFile()
    if (!path) return
    await save({ caPath: path })
    await inspect(path)
  }

  // Ports are saved on blur, not on every keystroke — an in-progress "80" must not persist.
  function onPortBlur(key: 'proxyPort' | 'upstreamPort', raw: string): void {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 65535) return
    if (n === settings[key]) return
    void save({ [key]: n } as Partial<Settings>)
  }

  async function onCopy(): Promise<void> {
    const r = await api.captureBurpConfig()
    if (!r.ok) { setNotice(r.error.message); return }
    await navigator.clipboard?.writeText(r.data)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Writing the file happens in main (Save dialog); the renderer only reports failure.
  async function onExport(): Promise<void> {
    const r = await api.captureExportConfig()
    if (!r.ok) setNotice(r.error.message)
  }

  return (
    <div className="card" style={{ padding: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
      <h3 className="section-title" style={{ fontSize: 15, marginBottom: 'var(--space-1)' }}>{t('capture.settingsTitle')}</h3>
      <p className="section-desc" style={{ marginTop: 0 }}>{t('capture.settingsHint')}</p>

      <label htmlFor="burp-ca" style={{ display: 'block', fontSize: 13, fontWeight: 510 }}>{t('capture.caLabel')}</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <input
          id="burp-ca"
          type="text"
          value={settings.caPath}
          onChange={(e) => setSettings((s) => ({ ...s, caPath: e.target.value }))}
          onBlur={(e) => { void save({ caPath: e.target.value }).then(() => inspect(e.target.value)) }}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onBrowse()}>{t('capture.caBrowse')}</button>
      </div>
      <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-1)' }}>{t('capture.caHint')}</p>
      {ca?.ok === true && <p style={{ fontSize: 12, color: 'var(--success, var(--accent))' }}>{t('capture.caValid', { name: ca.name, expires: ca.expires })}</p>}
      {ca?.ok === false && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{ca.message}</p>}

      <label htmlFor="burp-port" style={{ display: 'block', fontSize: 13, fontWeight: 510, marginTop: 'var(--space-3)' }}>{t('capture.proxyPort')}</label>
      <input
        id="burp-port"
        type="number"
        defaultValue={settings.proxyPort}
        key={`p-${settings.proxyPort}`}
        onBlur={(e) => onPortBlur('proxyPort', e.target.value)}
        style={{ width: 120 }}
      />

      <div style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
          {advanced ? '▾' : '▸'} {t('capture.advanced')}
        </button>
        {advanced && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <label htmlFor="burp-upstream" style={{ display: 'block', fontSize: 13, fontWeight: 510 }}>{t('capture.upstreamPort')}</label>
            <input
              id="burp-upstream"
              type="number"
              defaultValue={settings.upstreamPort}
              key={`u-${settings.upstreamPort}`}
              onBlur={(e) => onPortBlur('upstreamPort', e.target.value)}
              style={{ width: 120 }}
            />
            <p className="section-desc" style={{ fontSize: 12 }}>{t('capture.upstreamHint')}</p>
          </div>
        )}
      </div>

      <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border)' }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t('capture.burpRuleTitle')}</h4>
        <p className="section-desc" style={{ fontSize: 12 }}>{t('capture.burpRuleHint')}</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onExport()}>{t('capture.exportConfig')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onCopy()}>{copied ? t('capture.copied') : t('capture.copyConfig')}</button>
        </div>
      </div>

      {notice && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{notice}</p>}
    </div>
  )
}
