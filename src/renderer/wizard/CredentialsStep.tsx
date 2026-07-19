import { useState } from 'react'
import { KNOWN_SERVICES, serviceById } from '@shared/services'
import { toSbxName } from '@shared/names'
import { useT } from '../i18n'
import type { DraftCred, DraftCustomCred, DraftServiceCred } from './draft'

const rowStyle = { display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' as const, marginBottom: 'var(--space-2)' }
const field = { display: 'flex', flexDirection: 'column' as const, gap: 4 }
const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.04em' }
const hint = { fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }
const sectionLbl = { fontSize: 13, fontWeight: 600, margin: 'var(--space-4) 0 var(--space-2)' }
const credRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 6 } as const

// Text-style credential-type tab, matching the v7 mockup (.cred-type-tab).
function credTabStyle(active: boolean, disabled = false) {
  return {
    padding: 'var(--space-1) var(--space-3)', fontSize: 12, fontWeight: 600, border: 'none',
    borderRadius: 'var(--radius-sm)', fontFamily: 'inherit',
    background: active ? 'var(--bg-hover)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1
  } as const
}

function mask(value: string): string {
  return value.trim().length >= 4 ? '••••••••••••••••' + value.trim().slice(-4) : '••••••••••••••••'
}

/**
 * Credentials wizard step, mirroring the v5 mockup: Service / Custom / (Registry —
 * deferred) tabs, an Import-from-environment panel, and a security note. Service
 * values go to `sbx secret set`; custom secrets become a generated mixin-kit
 * serviceAuth four-block. Values are staged host-side on submit.
 */
export function CredentialsStep({ credentials, onAddService, onAddCustom, onRemove, envHits, onImport }: {
  credentials: DraftCred[]
  onAddService: (serviceId: string, envVar: string, value: string) => void
  onAddCustom: (cred: DraftCustomCred) => void
  onRemove: (index: number) => void
  envHits: { serviceId: string; label: string; envVar: string; masked: string }[]
  onImport: (serviceId: string, scope: 'sandbox' | 'global') => void
}): JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<'service' | 'custom'>('service')
  const [serviceId, setServiceId] = useState(KNOWN_SERVICES[0].id)
  const [svcValue, setSvcValue] = useState('')
  const [host, setHost] = useState('')
  const [envVar, setEnvVar] = useState('')
  const [customValue, setCustomValue] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importScope, setImportScope] = useState<'sandbox' | 'global'>('sandbox')

  const selectedSvc = serviceById(serviceId)
  const services = credentials.map((c, i) => ({ c, i })).filter((x): x is { c: DraftServiceCred; i: number } => x.c.kind === 'service')
  const customs = credentials.map((c, i) => ({ c, i })).filter((x): x is { c: DraftCustomCred; i: number } => x.c.kind === 'custom')

  function addService(): void {
    if (!selectedSvc || !svcValue.trim()) return
    onAddService(selectedSvc.id, selectedSvc.envVars[0], svcValue.trim())
    setSvcValue('')
  }
  function editService(c: DraftServiceCred, i: number): void {
    setTab('service'); setServiceId(c.serviceId); setSvcValue(c.value); onRemove(i)
  }
  function addCustom(): void {
    if (!host.trim() || !envVar.trim()) return
    onAddCustom({ kind: 'custom', id: toSbxName(host.trim()), label: host.trim(), envVar: envVar.trim(), domains: [host.trim()], value: customValue })
    setHost(''); setEnvVar(''); setCustomValue('')
  }
  function editCustom(c: DraftCustomCred, i: number): void {
    setTab('custom'); setHost(c.domains[0] ?? ''); setEnvVar(c.envVar); setCustomValue(c.value); onRemove(i)
  }
  function toggleSel(id: string): void {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function importSelected(): void {
    for (const id of selected) onImport(id, importScope)
    setSelected(new Set()); setImportOpen(false)
  }

  return (
    <>
      <label>{t('wizard.steps.credentials')}</label>
      <p className="section-desc" style={{ marginTop: 0 }}>{t('credentials.subtitle')}</p>

      <div role="tablist" style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-5)', borderBottom: '1px solid var(--border)', paddingBottom: 'var(--space-2)' }}>
        <button role="tab" aria-selected={tab === 'service'} style={credTabStyle(tab === 'service')} onClick={() => setTab('service')}>{t('credentials.tabService')}</button>
        <button role="tab" aria-selected={tab === 'custom'} style={credTabStyle(tab === 'custom')} onClick={() => setTab('custom')}>{t('credentials.tabCustom')}</button>
        <button role="tab" aria-selected={false} aria-disabled disabled title={t('credentials.registrySoon')} style={credTabStyle(false, true)}>{t('credentials.tabRegistry')}</button>
      </div>

      {tab === 'service' && (
        <>
          <p style={hint}>{t('credentials.serviceHint')}</p>

          {/* Import from environment variables (collapsible) */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', margin: 'var(--space-3) 0', overflow: 'hidden' }}>
            <button
              aria-expanded={importOpen}
              onClick={() => setImportOpen((v) => !v)}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: 'none', cursor: 'pointer' }}
            >
              <span aria-hidden style={{ color: 'var(--accent)' }}>→</span>
              <span style={{ flex: '1 1 auto' }}>
                <strong style={{ fontSize: 13 }}>{t('credentials.importTitle')}</strong>
                <span style={hint}> · {t('credentials.importSubtitle')}</span>
              </span>
              <span aria-hidden style={{ transform: importOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
            </button>
            {importOpen && (
              <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                {envHits.length === 0
                  ? <p style={{ ...hint, margin: 0 }}>{t('credentials.importNone')}</p>
                  : (
                    <>
                      {envHits.map((h) => (
                        <label key={h.serviceId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                          <input type="checkbox" checked={selected.has(h.serviceId)} onChange={() => toggleSel(h.serviceId)} />
                          <span>{h.label} <span className="code-inline">{h.envVar}</span> <span style={hint}>{h.masked}</span></span>
                        </label>
                      ))}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <span style={lbl}>{t('credentials.importScope')}</span>
                        <select aria-label="Import scope" className="input" style={{ maxWidth: 200 }} value={importScope} onChange={(e) => setImportScope(e.target.value as 'sandbox' | 'global')}>
                          <option value="sandbox">{t('credentials.scopeSandbox')}</option>
                          <option value="global">{t('credentials.scopeGlobal')}</option>
                        </select>
                        <button className="btn btn-primary btn-sm" disabled={selected.size === 0} onClick={importSelected}>{t('credentials.importSelected')}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setSelected(new Set()); setImportOpen(false) }}>{t('credentials.importCancel')}</button>
                        <span style={hint}>{selected.size} {t('credentials.selected')}</span>
                      </div>
                    </>
                  )}
              </div>
            )}
          </div>

          <div style={rowStyle}>
            <div style={{ ...field, flex: '1 1 320px' }}>
              <span style={lbl}>{t('credentials.service')}</span>
              <select aria-label="Service" className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                {KNOWN_SERVICES.map((s) => (<option key={s.id} value={s.id}>{s.label} — {s.envVars.join(' / ')}</option>))}
              </select>
            </div>
            <div style={{ ...field, flex: '1 1 200px' }}>
              <span style={lbl}>{t('credentials.value')}</span>
              <input aria-label="Value" type="password" className="input" placeholder="sk-ant-········" value={svcValue} onChange={(e) => setSvcValue(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={addService}>{t('credentials.add')}</button>
          </div>
          {selectedSvc && <p style={{ ...hint, marginTop: 0, marginBottom: 'var(--space-2)' }}>{selectedSvc.domains.join(', ')}</p>}
        </>
      )}

      {tab === 'custom' && (
        <>
          <p style={hint}>{t('credentials.customHint')}</p>
          <div style={rowStyle}>
            <div style={{ ...field, flex: '1 1 180px' }}>
              <span style={lbl}>{t('credentials.host')}</span>
              <input aria-label="Host / Domain" className="input" placeholder="api.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div style={{ ...field, flex: '1 1 160px' }}>
              <span style={lbl}>{t('credentials.envVar')}</span>
              <input aria-label="Environment Variable" className="input" placeholder="API_KEY" value={envVar} onChange={(e) => setEnvVar(e.target.value)} />
            </div>
            <div style={{ ...field, flex: '1 1 140px' }}>
              <span style={lbl}>{t('credentials.value')}</span>
              <input aria-label="Value" type="password" className="input" placeholder="secret" value={customValue} onChange={(e) => setCustomValue(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={addCustom}>{t('credentials.add')}</button>
          </div>
          <p style={hint}>{t('credentials.wildcardHint')}</p>
        </>
      )}

      {credentials.length === 0 && <p style={hint}>{t('credentials.none')}</p>}

      {services.length > 0 && (
        <>
          <p style={sectionLbl}>{t('credentials.addedService')}</p>
          {services.map(({ c, i }) => (
            <div key={i} style={credRow}>
              <span>
                <strong style={{ fontSize: 13 }}>{serviceById(c.serviceId)?.label ?? c.serviceId}</strong>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{c.envVar} = {!c.value.trim() && c.fromEnv ? t('credentials.fromEnv') : mask(c.value)}</span>
              </span>
              <span style={{ display: 'flex', gap: 'var(--space-3)', flexShrink: 0 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => editService(c, i)}>{t('credentials.edit')}</button>
                <button className="btn btn-ghost btn-sm" aria-label="Remove" style={{ color: 'var(--danger)' }} onClick={() => onRemove(i)}>{t('credentials.remove')}</button>
              </span>
            </div>
          ))}
        </>
      )}

      {customs.length > 0 && (
        <>
          <p style={sectionLbl}>{t('credentials.addedCustom')}</p>
          {customs.map(({ c, i }) => (
            <div key={i} style={credRow}>
              <span>
                <strong style={{ fontSize: 13 }}>{c.domains.join(', ')}</strong>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>{c.envVar} = {mask(c.value)}</span>
              </span>
              <span style={{ display: 'flex', gap: 'var(--space-3)', flexShrink: 0 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => editCustom(c, i)}>{t('credentials.edit')}</button>
                <button className="btn btn-ghost btn-sm" aria-label="Remove" style={{ color: 'var(--danger)' }} onClick={() => onRemove(i)}>{t('credentials.remove')}</button>
              </span>
            </div>
          ))}
        </>
      )}

      <div style={{ marginTop: 'var(--space-4)', padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--text-secondary)' }}>{t('credentials.securityLabel')}</strong> {t('credentials.securityNote')}
      </div>
    </>
  )
}
