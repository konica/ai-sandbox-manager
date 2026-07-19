import { useState } from 'react'
import { KNOWN_SERVICES, serviceById } from '@shared/services'
import { toSbxName } from '@shared/names'
import type { DraftCred, DraftCustomCred } from './draft'

const row = { display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' as const, marginBottom: 'var(--space-2)' }
const field = { display: 'flex', flexDirection: 'column' as const, gap: 4 }
const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.04em' }
const hint = { fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }

/**
 * Credentials wizard step. Two tabs mapping to the two sbx mechanisms:
 * - Service: a built-in service (value stored via `sbx secret set`; base kit owns serviceAuth).
 * - Custom: an arbitrary service injected via a generated mixin kit (serviceAuth four-block).
 * Import lists host env vars found for known services.
 */
export function CredentialsStep({ credentials, onAddService, onAddCustom, onRemove, envHits, onImport }: {
  credentials: DraftCred[]
  onAddService: (serviceId: string, envVar: string, value: string) => void
  onAddCustom: (cred: DraftCustomCred) => void
  onRemove: (index: number) => void
  envHits: { serviceId: string; label: string; envVar: string; masked: string }[]
  onImport: (serviceId: string, scope: 'sandbox' | 'global') => void
}): JSX.Element {
  const [tab, setTab] = useState<'service' | 'custom'>('service')
  const [serviceId, setServiceId] = useState(KNOWN_SERVICES[0].id)
  const [svcValue, setSvcValue] = useState('')
  const [host, setHost] = useState('')
  const [envVar, setEnvVar] = useState('')
  const [headerName, setHeaderName] = useState('Authorization')
  const [valueFormat, setValueFormat] = useState('Bearer %s')
  const [customValue, setCustomValue] = useState('')

  const selected = serviceById(serviceId)

  function addService(): void {
    if (!selected || !svcValue.trim()) return
    onAddService(selected.id, selected.envVars[0], svcValue.trim())
    setSvcValue('')
  }
  function addCustom(): void {
    if (!host.trim() || !envVar.trim()) return
    const id = toSbxName(host.trim())
    onAddCustom({ kind: 'custom', id, label: host.trim(), envVar: envVar.trim(), domains: [host.trim()], headers: [{ name: headerName.trim() || 'Authorization', format: valueFormat.trim() || '%s' }], value: customValue })
    setHost(''); setEnvVar(''); setCustomValue('')
  }

  return (
    <>
      <label>Credentials</label>
      <p className="section-desc" style={{ marginTop: 0 }}>API keys and secrets. Values are stored on the host (OS keychain or encrypted) and injected by the proxy — the sandbox never sees them.</p>

      <div role="tablist" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <button role="tab" aria-selected={tab === 'service'} className={`btn btn-sm ${tab === 'service' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('service')}>Service</button>
        <button role="tab" aria-selected={tab === 'custom'} className={`btn btn-sm ${tab === 'custom' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('custom')}>Custom</button>
      </div>

      {tab === 'service' && (
        <div style={row}>
          <div style={{ ...field, flex: '1 1 320px' }}>
            <span style={lbl}>Service</span>
            <select aria-label="Service" className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {KNOWN_SERVICES.map((s) => (<option key={s.id} value={s.id}>{s.label} — {s.envVars[0]}</option>))}
            </select>
            {selected && <p style={hint}>{selected.domains.join(', ')}</p>}
          </div>
          <div style={{ ...field, flex: '1 1 200px' }}>
            <span style={lbl}>Value</span>
            <input aria-label="Value" type="password" className="input" placeholder="sk-…" value={svcValue} onChange={(e) => setSvcValue(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={addService}>Add</button>
        </div>
      )}

      {tab === 'custom' && (
        <div style={row}>
          <div style={{ ...field, flex: '1 1 160px' }}>
            <span style={lbl}>Host / Domain</span>
            <input aria-label="Host / Domain" className="input" placeholder="api.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div style={{ ...field, flex: '1 1 140px' }}>
            <span style={lbl}>Environment Variable</span>
            <input aria-label="Environment Variable" className="input" placeholder="API_KEY" value={envVar} onChange={(e) => setEnvVar(e.target.value)} />
          </div>
          <div style={{ ...field, flex: '1 1 120px' }}>
            <span style={lbl}>Header Name</span>
            <input aria-label="Header Name" className="input" value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
          </div>
          <div style={{ ...field, flex: '1 1 120px' }}>
            <span style={lbl}>Value Format</span>
            <input aria-label="Value Format" className="input" value={valueFormat} onChange={(e) => setValueFormat(e.target.value)} />
          </div>
          <div style={{ ...field, flex: '1 1 140px' }}>
            <span style={lbl}>Value</span>
            <input aria-label="Value" type="password" className="input" placeholder="secret" value={customValue} onChange={(e) => setCustomValue(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={addCustom}>Add</button>
        </div>
      )}

      <div style={{ marginTop: 'var(--space-2)' }}>
        {credentials.length === 0 && <p style={hint}>No credentials added.</p>}
        {credentials.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }}>
            <span style={{ fontSize: 13 }}>
              {c.kind === 'service'
                ? <>{serviceById(c.serviceId)?.label ?? c.serviceId} <span className="code-inline">{c.envVar}</span></>
                : <>{c.label} <span className="code-inline">{c.envVar}</span> <span style={hint}>{c.domains.join(', ')}</span></>}
            </span>
            <button className="btn btn-ghost btn-sm" aria-label="Remove" onClick={() => onRemove(i)}>Remove</button>
          </div>
        ))}
      </div>

      {envHits.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <label>Import from environment variables</label>
          {envHits.map((h) => (<ImportRow key={h.serviceId} hit={h} onImport={onImport} />))}
        </div>
      )}
    </>
  )
}

function ImportRow({ hit, onImport }: { hit: { serviceId: string; label: string; envVar: string; masked: string }; onImport: (serviceId: string, scope: 'sandbox' | 'global') => void }): JSX.Element {
  const [scope, setScope] = useState<'sandbox' | 'global'>('sandbox')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }}>
      <span style={{ fontSize: 13, flex: '1 1 auto' }}>{hit.label} <span className="code-inline">{hit.envVar}</span> <span style={hint}>{hit.masked}</span></span>
      <select aria-label={`Scope for ${hit.label}`} className="input" style={{ maxWidth: 150 }} value={scope} onChange={(e) => setScope(e.target.value as 'sandbox' | 'global')}>
        <option value="sandbox">This sandbox</option>
        <option value="global">Global</option>
      </select>
      <button className="btn btn-secondary btn-sm" onClick={() => onImport(hit.serviceId, scope)}>Import</button>
    </div>
  )
}
