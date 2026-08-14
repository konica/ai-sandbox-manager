import { useState } from 'react'
import type { McpAddInput } from '@shared/mcp'
import { api } from '../ipc/client'
import { useT } from '../i18n'

type Tab = 'remote' | 'local' | 'command'

const field = { display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 'var(--space-3)' }
const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.04em' }
const errStyle = { color: 'var(--danger)', fontSize: 12, margin: '4px 0 0' }

function tabStyle(active: boolean) {
  return {
    padding: 'var(--space-1) var(--space-3)', fontSize: 12, fontWeight: 600, border: 'none',
    borderRadius: 'var(--radius-sm)', fontFamily: 'inherit',
    background: active ? 'var(--bg-hover)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer'
  } as const
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'https:'
  } catch {
    return false
  }
}

type Errors = { name?: string; url?: string; command?: string; ack?: string }

/**
 * sbx buries the actionable line behind four INFO lines of runtime chatter:
 *   "...ERROR: server "x" advertises no registration endpoint (no dynamic client
 *    registration); --client-id is required to register it"
 * Detect that shape so the form can point at the OAuth client ID field.
 */
function needsClientId(message: string): boolean {
  return /--client-id is required|no dynamic client registration/i.test(message)
}

/**
 * Inline "Add Server" form for the MCP Servers screen: Remote / Local (stdio) / Command
 * tabs mapped 1:1 to the `McpAddInput` transport union. Local and Command both register
 * host-executing servers (confirmed by the Phase 0 spike, issue #16) so both require the
 * reused host-access warning and an explicit acknowledgment before submit proceeds.
 */
export function McpAddForm({ existingNames, onAdded, onCancel }: {
  existingNames: string[]
  onAdded: () => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<Tab>('remote')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [metadataUrl, setMetadataUrl] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [ack, setAck] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [cliError, setCliError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function switchTab(next: Tab): void {
    setTab(next)
    setErrors({})
    setCliError(null)
  }

  function validate(): Errors {
    const errs: Errors = {}
    const trimmedName = name.trim()
    if (!trimmedName) {
      errs.name = t('mcp.add.errNameRequired')
    } else if (existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase())) {
      errs.name = t('mcp.add.errNameDuplicate', { name: trimmedName })
    }

    if (tab === 'remote') {
      if (!isHttpsUrl(url)) errs.url = t('mcp.add.errUrlInvalid')
    } else if (tab === 'local') {
      if (!isHttpsUrl(metadataUrl)) errs.url = t('mcp.add.errUrlInvalid')
      if (!ack) errs.ack = t('mcp.add.errAckRequired')
    } else {
      if (!command.trim()) errs.command = t('mcp.add.errCommandRequired')
      if (!ack) errs.ack = t('mcp.add.errAckRequired')
    }
    return errs
  }

  function buildInput(): McpAddInput {
    const trimmedName = name.trim()
    if (tab === 'remote') {
      const trimmedClientId = clientId.trim()
      // Omit the key entirely rather than sending an empty string, so the adapter never
      // puts a bare `--client-id ''` on argv.
      return {
        transport: 'remote', name: trimmedName, url: url.trim(), scopes: [],
        ...(trimmedClientId ? { clientId: trimmedClientId } : {})
      }
    }
    if (tab === 'local') return { transport: 'local', name: trimmedName, metadataUrl: metadataUrl.trim(), scopes: [] }
    return { transport: 'command', name: trimmedName, command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [], scopes: [] }
  }

  async function submit(): Promise<void> {
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSubmitting(true)
    setCliError(null)
    const r = await api.mcpAdd(buildInput())
    setSubmitting(false)
    if (!r.ok) { setCliError(r.error.message); return }
    onAdded()
  }

  const showWarning = tab === 'local' || tab === 'command'

  return (
    <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
      <div role="tablist" aria-label={t('mcp.add.tablistLabel')} style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-3)', borderBottom: '1px solid var(--border)', paddingBottom: 'var(--space-2)' }}>
        <button type="button" role="tab" aria-selected={tab === 'remote'} style={tabStyle(tab === 'remote')} onClick={() => switchTab('remote')}>{t('mcp.add.tabRemote')}</button>
        <button type="button" role="tab" aria-selected={tab === 'local'} style={tabStyle(tab === 'local')} onClick={() => switchTab('local')}>{t('mcp.add.tabLocal')}</button>
        <button type="button" role="tab" aria-selected={tab === 'command'} style={tabStyle(tab === 'command')} onClick={() => switchTab('command')}>{t('mcp.add.tabCommand')}</button>
      </div>

      <div style={field}>
        <span style={lbl}>{t('mcp.add.nameLabel')}</span>
        <input aria-label="Server name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('mcp.add.namePlaceholder')} />
        {errors.name && <p role="alert" style={errStyle}>{errors.name}</p>}
      </div>

      {tab === 'remote' && (
        <>
          <div style={field}>
            <span style={lbl}>{t('mcp.add.urlLabel')}</span>
            <input aria-label="Server URL" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('mcp.add.urlPlaceholder')} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>{t('mcp.add.urlHint')}</p>
            {errors.url && <p role="alert" style={errStyle}>{errors.url}</p>}
          </div>
          <div style={field}>
            <span style={lbl}>{t('mcp.add.clientIdLabel')}</span>
            <input aria-label="OAuth client ID" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={t('mcp.add.clientIdPlaceholder')} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>{t('mcp.add.clientIdHint')}</p>
          </div>
        </>
      )}

      {tab === 'local' && (
        <div style={field}>
          <span style={lbl}>{t('mcp.add.metadataUrlLabel')}</span>
          <input aria-label="Metadata URL" className="input" value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} placeholder={t('mcp.add.metadataUrlPlaceholder')} />
          {errors.url && <p role="alert" style={errStyle}>{errors.url}</p>}
        </div>
      )}

      {tab === 'command' && (
        <>
          <div style={field}>
            <span style={lbl}>{t('mcp.add.commandLabel')}</span>
            <input aria-label="Command" className="input" value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t('mcp.add.commandPlaceholder')} />
            {errors.command && <p role="alert" style={errStyle}>{errors.command}</p>}
          </div>
          <div style={field}>
            <span style={lbl}>{t('mcp.add.argsLabel')}</span>
            <input aria-label="Arguments" className="input" value={args} onChange={(e) => setArgs(e.target.value)} placeholder={t('mcp.add.argsPlaceholder')} />
          </div>
        </>
      )}

      {showWarning && (
        <div className="warning-box" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <strong>{t('mcp.add.warningTitle')}</strong>
          <p style={{ margin: '4px 0 8px' }}>{t('mcp.add.warningBody')}</p>
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            {t('mcp.add.ackLabel')}
          </label>
          {errors.ack && <p role="alert" style={errStyle}>{errors.ack}</p>}
        </div>
      )}

      {cliError && (
        <>
          <p role="alert" style={{ ...errStyle, marginTop: 'var(--space-3)' }}>{t('mcp.add.addFailed', { message: cliError })}</p>
          {needsClientId(cliError) && <p role="alert" style={{ ...errStyle, color: 'var(--text-primary)' }}>{t('mcp.add.clientIdRequiredHint')}</p>}
        </>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={submitting} onClick={() => void submit()}>{t('mcp.add.submit')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  )
}
