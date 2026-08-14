import type { McpMode, McpServer, McpAuthState } from '@shared/mcp'
import { McpAuthBadge, mcpAuthBucket } from '../components/badges'
import { isLocalStdio } from '../screens/McpServers'
import { useT } from '../i18n'

type ListState = 'loading' | 'error' | 'ready'

const MODES: { value: McpMode; descKey: string }[] = [
  { value: 'off', descKey: 'wizard.mcpModeOffDesc' },
  { value: 'dynamic', descKey: 'wizard.mcpModeDynamicDesc' },
  { value: 'static', descKey: 'wizard.mcpModeStaticDesc' }
]

const listRow = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 4, fontSize: 13, cursor: 'pointer' } as const

/**
 * MCP Servers wizard step (v8): Off/Dynamic/Static binding mode, mirroring the Network
 * tier cards. Static additionally lists registered servers (from mcp:list, fetched by the
 * parent) as a checkbox multi-select, each tagged with its transport type and auth state.
 */
export function McpStep({
  mode, selected, agentLabel, agentMcpSupported, listState, errorMessage, servers, auth, onModeChange, onToggleServer
}: {
  mode: McpMode
  selected: string[]
  agentLabel: string
  agentMcpSupported: boolean
  listState: ListState
  errorMessage?: string
  servers: McpServer[]
  auth: Record<string, McpAuthState>
  onModeChange: (mode: McpMode) => void
  onToggleServer: (name: string) => void
}): JSX.Element {
  const t = useT()
  const selectedServers = servers.filter((s) => selected.includes(s.name))
  const showLocalStdioWarning = mode === 'static' && selectedServers.some((s) => isLocalStdio(s.transport))
  const showNeedsAuthNudge = mode === 'static' && servers.some((s) => mcpAuthBucket(auth[s.name] ?? 'unknown') === 'needs-auth')

  return (
    <>
      <label>{t('wizard.mcpTitle')}</label>
      <p className="section-desc" style={{ marginTop: 0, marginBottom: 'var(--space-3)' }}>{t('wizard.mcpSubtitle')}</p>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        {MODES.map((m) => (
          <label key={m.value} style={{ flex: 1, display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', padding: 'var(--space-3)', border: `1px solid ${mode === m.value ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            <input type="radio" name="mcpMode" style={{ marginTop: 3 }} checked={mode === m.value} onChange={() => onModeChange(m.value)} />
            <span>
              <strong style={{ fontSize: 13 }}>{t(`wizard.mcpMode.${m.value}`)}{m.value === 'static' ? ` (${servers.length})` : ''}</strong>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t(m.descKey)}</div>
            </span>
          </label>
        ))}
      </div>

      {mode === 'static' && (
        <>
          {listState === 'loading' && <p className="section-desc">{t('mcp.loading')}</p>}
          {listState === 'error' && <p className="section-desc" style={{ color: 'var(--danger)' }}>{t('mcp.error', { message: errorMessage ?? '' })}</p>}
          {listState === 'ready' && servers.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-5)' }}>
              <p className="section-desc" style={{ marginBottom: 0 }}>{t('wizard.mcpEmptyRegistry')}</p>
            </div>
          )}
          {listState === 'ready' && servers.length > 0 && (
            <div>
              {servers.map((s) => (
                <label key={s.name} style={listRow}>
                  <input type="checkbox" checked={selected.includes(s.name)} onChange={() => onToggleServer(s.name)} />
                  <span style={{ flex: '0 0 auto', fontWeight: 510 }}>{s.name}</span>
                  <span className={`badge ${isLocalStdio(s.transport) ? 'tier-balanced' : 'badge-stopped'}`}>{t(`mcp.transport.${s.transport}`)}</span>
                  <McpAuthBadge state={auth[s.name] ?? 'unknown'} />
                </label>
              ))}
            </div>
          )}
          {showNeedsAuthNudge && <p className="section-desc" style={{ fontSize: 11, marginTop: 'var(--space-2)' }}>{t('wizard.mcpNeedsAuthNudge')}</p>}
          {showLocalStdioWarning && (
            <div className="warning-box" style={{ flexDirection: 'column', alignItems: 'flex-start', marginTop: 'var(--space-3)' }}>
              <strong>{t('mcp.add.warningTitle')}</strong>
              <p style={{ margin: '4px 0 0' }}>{t('mcp.add.warningBody')}</p>
            </div>
          )}
        </>
      )}

      {!agentMcpSupported && (
        <p className="section-desc" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.mcpAgentUnsupported', { agent: agentLabel })}</p>
      )}
    </>
  )
}
