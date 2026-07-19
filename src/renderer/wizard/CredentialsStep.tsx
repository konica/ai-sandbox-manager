import { useState } from 'react'
import { KNOWN_SERVICES, serviceById } from '@shared/services'
import { toSbxName } from '@shared/names'
import { useT } from '../i18n'
import type { DraftCred, DraftCustomCred } from './draft'

const rowStyle = { display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' as const, marginBottom: 'var(--space-2)' }
const field = { display: 'flex', flexDirection: 'column' as const, gap: 4 }
const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.04em' }
const hint = { fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }
const sectionLbl = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.04em', margin: 'var(--space-3) 0 var(--space-1)' }

function mask(value: string): string {
  return value.trim().length >= 4 ? '••••••••' + value.trim().slice(-4) : '••••••••'
}

/**
 * Credentials wizard step, mirroring the v5 mockup: Service / Custom / (Registry —
 * deferred) tabs. Service values go to `sbx secret set`; custom secrets become a
 * generated mixin-kit serviceAuth four-block. Values are staged host-side on submit.
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
  const [headerName, setHeaderName] = useState('Authorization')
  const [valueFormat, setValueFormat] = useState('Bearer %s')
  const [customValue, setCustomValue] = useState('')

  const selected = serviceById(serviceId)
  const services = credentials.map((c, i) => ({ c, i })).filter((x) => x.c.kind === 'service')
  const customs = credentials.map((c, i) => ({ c, i })).filter((x) => x.c.kind === 'custom')

  function addService(): void {
    if (!selected || !svcValue.trim()) return
    onAddService(selected.id, selected.envVars[0], svcValue.trim())
    setSvcValue('')
  }
  function addCustom(): void {
    if (!host.trim() || !envVar.trim()) return
    onAddCustom({
      kind: 'custom', id: toSbxName(host.trim()), label: host.trim(), envVar: envVar.trim(),
      domains: [host.trim()], headers: [{ name: headerName.trim() || 'Authorization', format: valueFormat.trim() || '%s' }], value: customValue
    })
    setHost(''); setEnvVar(''); setCustomValue('')
  }

  function tabBtn(id: 'service' | 'custom', label: string): JSX.Element {
    return (
      <button role="tab" aria-selected={tab === id} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(id)}>{label}</button>
    )
  }

  return (
    <>
      <label>{t('wizard.steps.credentials')}</label>
      <p className="section-desc" style={{ marginTop: 0 }}>{t('credentials.subtitle')}</p>

      <div role="tablist" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        {tabBtn('service', t('credentials.tabService'))}
        {tabBtn('custom', t('credentials.tabCustom'))}
        <button role="tab" aria-selected={false} aria-disabled className="btn btn-sm btn-secondary" disabled title={t('credentials.registrySoon')} style={{ opacity: 0.5 }}>{t('credentials.tabRegistry')}</button>
      </div>

      {tab === 'service' && (
        <>
          <p style={hint}>{t('credentials.serviceHint')}</p>
          <div style={rowStyle}>
            <div style={{ ...field, flex: '1 1 320px' }}>
              <span style={lbl}>{t('credentials.service')}</span>
              <select aria-label="Service" className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                {KNOWN_SERVICES.map((s) => (<option key={s.id} value={s.id}>{s.label} — {s.envVars.join(' / ')}</option>))}
              </select>
              {selected && <p style={hint}>{selected.domains.join(', ')}</p>}
            </div>
            <div style={{ ...field, flex: '1 1 200px' }}>
              <span style={lbl}>{t('credentials.value')}</span>
              <input aria-label="Value" type="password" className="input" placeholder="sk-…" value={svcValue} onChange={(e) => setSvcValue(e.target.value)} />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={addService}>{t('credentials.add')}</button>
          </div>
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
          </div>
          <div style={rowStyle}>
            <div style={{ ...field, flex: '1 1 180px' }}>
              <span style={lbl}>{t('credentials.headerName')}</span>
              <input aria-label="Header Name" className="input" value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
            </div>
            <div style={{ ...field, flex: '1 1 180px' }}>
              <span style={lbl}>{t('credentials.valueFormat')}</span>
              <input aria-label="Value Format" className="input" value={valueFormat} onChange={(e) => setValueFormat(e.target.value)} />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={addCustom}>{t('credentials.add')}</button>
          </div>
          <p style={hint}>{t('credentials.wildcardHint')}</p>
        </>
      )}

      {credentials.length === 0 && <p style={hint}>{t('credentials.none')}</p>}

      {services.length > 0 && (
        <>
          <p style={sectionLbl}>{t('credentials.addedService')}</p>
          {services.map(({ c, i }) => c.kind === 'service' && (
            <div key={i} style={credRow}>
              <span style={{ fontSize: 13 }}>{serviceById(c.serviceId)?.label ?? c.serviceId} <span className="code-inline">{c.envVar}</span> <span style={hint}>= {mask(c.value)}</span></span>
              <button className="btn btn-ghost btn-sm" aria-label="Remove" onClick={() => onRemove(i)}>{t('credentials.remove')}</button>
            </div>
          ))}
        </>
      )}

      {customs.length > 0 && (
        <>
          <p style={sectionLbl}>{t('credentials.addedCustom')}</p>
          {customs.map(({ c, i }) => c.kind === 'custom' && (
            <div key={i} style={credRow}>
              <span style={{ fontSize: 13 }}>{c.domains.join(', ')} <span style={hint}>{c.headers[0]?.name}: {c.headers[0]?.format} ← </span><span className="code-inline">{c.envVar}</span> <span style={hint}>= {mask(c.value)}</span></span>
              <button className="btn btn-ghost btn-sm" aria-label="Remove" onClick={() => onRemove(i)}>{t('credentials.remove')}</button>
            </div>
          ))}
        </>
      )}

      {envHits.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <label>{t('credentials.importTitle')}</label>
          <p className="section-desc" style={{ marginTop: 0 }}>{t('credentials.importSubtitle')}</p>
          {envHits.map((h) => (<ImportRow key={h.serviceId} hit={h} onImport={onImport} t={t} />))}
        </div>
      )}
    </>
  )
}

const credRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 4 } as const

function ImportRow({ hit, onImport, t }: { hit: { serviceId: string; label: string; envVar: string; masked: string }; onImport: (serviceId: string, scope: 'sandbox' | 'global') => void; t: (k: string, v?: Record<string, string | number>) => string }): JSX.Element {
  const [scope, setScope] = useState<'sandbox' | 'global'>('sandbox')
  return (
    <div style={credRow}>
      <span style={{ fontSize: 13, flex: '1 1 auto' }}>{hit.label} <span className="code-inline">{hit.envVar}</span> <span style={hint}>{hit.masked}</span></span>
      <select aria-label={`Scope for ${hit.label}`} className="input" style={{ maxWidth: 180 }} value={scope} onChange={(e) => setScope(e.target.value as 'sandbox' | 'global')}>
        <option value="sandbox">{t('credentials.scopeSandbox')}</option>
        <option value="global">{t('credentials.scopeGlobal')}</option>
      </select>
      <button className="btn btn-secondary btn-sm" onClick={() => onImport(hit.serviceId, scope)}>{t('credentials.import')}</button>
    </div>
  )
}
