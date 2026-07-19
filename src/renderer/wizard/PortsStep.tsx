import { useState } from 'react'
import type { PortProtocol } from '@shared/types'
import { useT } from '../i18n'
import { parsePort } from './draft'

const rowStyle = { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' as const }
const sectionHead = { display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', marginTop: 'var(--space-5)' }
const secLbl = { fontSize: 12, fontWeight: 510, color: 'var(--text-secondary)' }
const secHint = { fontSize: 11, color: 'var(--text-muted)' }
const listRow = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 4, fontSize: 13 } as const
const mono = { fontFamily: 'var(--font-mono, monospace)' } as const
const pill = { fontSize: 11, padding: '1px 8px', borderRadius: 999, background: 'var(--bg-hover)', color: 'var(--text-muted)' } as const
const box = { padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 12, marginTop: 'var(--space-2)' } as const

const PROTOCOLS: { value: PortProtocol; label: string }[] = [
  { value: 'tcp', label: 'TCP' }, { value: 'tcp4', label: 'TCP4' }, { value: 'tcp6', label: 'TCP6' }
]

/**
 * Ports step (v7): "Forward ports into sandbox" (host → sandbox, with protocol and
 * ephemeral host ports) and "Access host services from sandbox" (host.docker.internal,
 * each contributing localhost:<port> to the network allowlist).
 */
export function PortsStep({ ports, hostServices, onAddPort, onRemovePort, onAddHostService, onRemoveHostService }: {
  ports: { hostPort: number | null; containerPort: number; protocol: PortProtocol; label: string }[]
  hostServices: { hostPort: number; label: string }[]
  onAddPort: (hostPort: number | null, containerPort: number, protocol: PortProtocol, label: string) => void
  onRemovePort: (index: number) => void
  onAddHostService: (hostPort: number, label: string) => void
  onRemoveHostService: (index: number) => void
}): JSX.Element {
  const t = useT()
  const [portInput, setPortInput] = useState('')
  const [protocol, setProtocol] = useState<PortProtocol>('tcp')
  const [portLabel, setPortLabel] = useState('')
  const [hostPort, setHostPort] = useState('')
  const [hostLabel, setHostLabel] = useState('')

  function addPort(): void {
    const parsed = parsePort(portInput)
    if (!parsed) return
    onAddPort(parsed.hostPort, parsed.containerPort, protocol, portLabel.trim())
    setPortInput(''); setPortLabel('')
  }
  function addHost(): void {
    const n = Number(hostPort)
    if (!Number.isInteger(n) || n < 1 || n > 65535) return
    onAddHostService(n, hostLabel.trim())
    setHostPort(''); setHostLabel('')
  }

  return (
    <>
      <label>{t('wizard.steps.ports')}</label>
      <p className="section-desc" style={{ marginTop: 0 }}>{t('ports.subtitle')}</p>

      {/* Section A — forward ports into the sandbox */}
      <div style={{ ...sectionHead, marginTop: 0 }}>
        <span style={secLbl}>{t('ports.forwardTitle')}</span>
        <span style={secHint}>— {t('ports.forwardHint')}</span>
      </div>

      <div>
        {ports.map((p, i) => (
          <div key={i} style={listRow}>
            <span style={{ ...mono, flex: '0 0 auto' }}>
              {p.hostPort !== null && <>{p.hostPort} </>}→ {p.containerPort}<span style={secHint}>/{p.protocol}</span>
            </span>
            {p.label && <span style={{ ...secHint, flex: '1 1 auto' }}>{p.label}</span>}
            <span style={{ ...pill, marginLeft: 'auto' }}>{t('ports.willForward')}</span>
            <button className="btn btn-ghost btn-sm" aria-label="Remove port" onClick={() => onRemovePort(i)}>✕</button>
          </div>
        ))}
      </div>

      <div style={rowStyle}>
        <input aria-label="Port mapping" className="input input-mono" style={{ flex: 1, minWidth: 200 }} placeholder={t('ports.portPlaceholder')} value={portInput} onChange={(e) => setPortInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addPort() }} />
        <select aria-label="Protocol" className="input" style={{ width: 90 }} value={protocol} onChange={(e) => setProtocol(e.target.value as PortProtocol)}>
          {PROTOCOLS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
        </select>
        <input aria-label="Port label" className="input" style={{ width: 140 }} placeholder={t('ports.labelPlaceholder')} value={portLabel} onChange={(e) => setPortLabel(e.target.value)} />
        <button className="btn btn-secondary btn-sm" onClick={addPort}>{t('ports.add')}</button>
      </div>

      <div style={{ ...box, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--text-secondary)' }}>{t('ports.howTitle')}</strong>
        <ul style={{ margin: 'var(--space-2) 0 0 var(--space-4)', padding: 0, lineHeight: 1.7 }}>
          <li>{t('ports.howWillForward')}</li>
          <li>{t('ports.howExplicit')}</li>
          <li>{t('ports.howEphemeral')}</li>
          <li>{t('ports.howProtocol')}</li>
          <li>{t('ports.howLoopback')}</li>
        </ul>
      </div>

      {/* Section B — access host services from the sandbox */}
      <div style={sectionHead}>
        <span style={secLbl}>{t('ports.hostTitle')}</span>
        <span style={secHint}>— {t('ports.hostHint')}</span>
      </div>
      <p style={{ ...secHint, marginTop: 0, lineHeight: 1.5 }}>{t('ports.hostDesc')}</p>

      <div>
        {hostServices.map((hs, i) => (
          <div key={i} style={listRow}>
            <span style={{ ...mono, flex: '0 0 auto' }}>host.docker.internal:{hs.hostPort}</span>
            {hs.label && <span style={secHint}>{hs.label}</span>}
            <span style={{ ...secHint, marginLeft: 'auto' }}>{t('ports.allowlist', { port: hs.hostPort })}</span>
            <button className="btn btn-ghost btn-sm" aria-label="Remove host service" onClick={() => onRemoveHostService(i)}>✕</button>
          </div>
        ))}
      </div>

      <div style={rowStyle}>
        <input aria-label="Host port" type="number" min={1} max={65535} className="input input-mono" style={{ flex: '0 0 160px' }} placeholder={t('ports.hostPortPlaceholder')} value={hostPort} onChange={(e) => setHostPort(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addHost() }} />
        <input aria-label="Service name" className="input" style={{ flex: 1, minWidth: 160 }} placeholder={t('ports.serviceNamePlaceholder')} value={hostLabel} onChange={(e) => setHostLabel(e.target.value)} />
        <button className="btn btn-secondary btn-sm" onClick={addHost}>{t('ports.addHostService')}</button>
      </div>

      <div style={{ ...box, background: 'var(--warning-bg, rgba(200,150,0,.12))', color: 'var(--warning, #b8860b)' }}>
        {t('ports.hostWarning')}
      </div>
    </>
  )
}
