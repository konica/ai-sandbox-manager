import { useState } from 'react'
import type { InstanceView, LivePort, HostServiceIntent, PortProtocol } from '@shared/types'
import { parsePort } from '../../wizard/draft'
import { useT } from '../../i18n'

const PROTOCOLS: { value: PortProtocol; label: string }[] = [
  { value: 'tcp', label: 'TCP' }, { value: 'tcp4', label: 'TCP4' }, { value: 'tcp6', label: 'TCP6' }
]
const rowGap = { display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' as const }

/**
 * Ports tab: live port forwards (add/remove on the running sandbox) and editable host
 * services (host.docker.internal → localhost allowlist). Every edit dual-writes: live
 * to the sandbox AND to the definition (skipped for unlinked instances).
 */
export function PortsTab({ instance, ports, hostServices, linked, onPublish, onUnpublish, onAddHostService, onRemoveHostService }: {
  instance: InstanceView
  ports: LivePort[]
  hostServices: HostServiceIntent[]
  linked: boolean
  onPublish: (port: LivePort) => void
  onUnpublish: (port: LivePort) => void
  onAddHostService: (hostPort: number, label: string) => void
  onRemoveHostService: (hostPort: number) => void
}): JSX.Element {
  const t = useT()
  const running = instance.status === 'running'
  const [portInput, setPortInput] = useState('')
  const [protocol, setProtocol] = useState<PortProtocol>('tcp')
  const [hostPort, setHostPort] = useState('')
  const [hostLabel, setHostLabel] = useState('')

  function addForward(): void {
    const parsed = parsePort(portInput)
    if (!parsed) return
    onPublish({ hostPort: parsed.hostPort, containerPort: parsed.containerPort, protocol })
    setPortInput('')
  }
  function addHost(): void {
    const n = Number(hostPort)
    if (!Number.isInteger(n) || n < 1 || n > 65535) return
    onAddHostService(n, hostLabel.trim())
    setHostPort(''); setHostLabel('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {!linked && (
        <div className="card" style={{ background: 'var(--warning-bg, rgba(200,150,0,.12))', color: 'var(--warning, #b8860b)', fontSize: 12 }}>
          {t('detail.notLinkedNote')}
        </div>
      )}

      <div className="card">
        <div className="card-header"><div className="card-title">{t('detail.portForwarding')}</div></div>
        <p className="section-desc" style={{ marginTop: 0 }}>{t('detail.postRunNote')}</p>
        {ports.length === 0
          ? <p className="section-desc" style={{ fontSize: 12 }}>{t('detail.noForwards')}</p>
          : ports.map((p, i) => (
            <div key={i} className="port-row">
              <span className="port-spec"><span className="port-host">{p.hostPort ?? '→'}</span><span className="port-arrow"> → </span><span className="port-container">{p.containerPort}</span><span className="port-proto">/{p.protocol}</span></span>
              <span className="port-status active" style={{ marginLeft: 'auto' }}>● {t('detail.active')}</span>
              <button className="tag-remove" aria-label="Remove forward" onClick={() => onUnpublish(p)}>✕</button>
            </div>
          ))}
        <div style={rowGap}>
          <input aria-label="Port mapping" className="input input-mono" style={{ flex: 1, minWidth: 200, fontSize: 12 }} placeholder={t('ports.portPlaceholder')} value={portInput} disabled={!running} onChange={(e) => setPortInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addForward() }} />
          <select aria-label="Protocol" className="input" style={{ width: 90, fontSize: 12 }} value={protocol} onChange={(e) => setProtocol(e.target.value as PortProtocol)}>
            {PROTOCOLS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
          </select>
          <button className="btn btn-secondary btn-sm" disabled={!running} onClick={addForward}>{t('detail.forward')}</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">{t('detail.hostServices')}</div></div>
        <p className="section-desc" style={{ marginTop: 0 }}>{t('ports.hostDesc')}</p>
        {hostServices.map((h, i) => (
          <div key={i} className="port-row">
            <span className="port-spec"><span className="port-host">host.docker.internal</span><span className="port-arrow">:</span><span className="port-container">{h.hostPort}</span></span>
            {h.label && <span className="port-meta">{h.label}</span>}
            <span className="port-status info" style={{ marginLeft: 'auto' }}>{t('ports.allowlist', { port: h.hostPort })}</span>
            <button className="tag-remove" aria-label="Remove host service" onClick={() => onRemoveHostService(h.hostPort)}>✕</button>
          </div>
        ))}
        <div style={rowGap}>
          <input aria-label="Host port" type="number" min={1} max={65535} className="input input-mono" style={{ flex: '0 0 160px', fontSize: 12 }} placeholder={t('ports.hostPortPlaceholder')} value={hostPort} disabled={!running} onChange={(e) => setHostPort(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addHost() }} />
          <input aria-label="Service name" className="input" style={{ flex: 1, minWidth: 160, fontSize: 12 }} placeholder={t('ports.serviceNamePlaceholder')} value={hostLabel} disabled={!running} onChange={(e) => setHostLabel(e.target.value)} />
          <button className="btn btn-secondary btn-sm" disabled={!running} onClick={addHost}>{t('ports.addHostService')}</button>
        </div>
      </div>
    </div>
  )
}
