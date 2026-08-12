import { useCallback, useEffect, useState } from 'react'
import type { McpServer, McpServerDetail, McpAuthState } from '@shared/mcp'
import type { Definition, InstanceView } from '@shared/types'
import { redactMcpEndpoint } from '@shared/mcp-redact'
import { McpAuthBadge } from '../components/badges'
import { api } from '../ipc/client'
import { useT } from '../i18n'

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; servers: McpServer[]; auth: Record<string, McpAuthState> }

type InspectState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: McpServerDetail; auth: McpAuthState; usedByDefs: number; usedByInstances: number }

/** 'command' spawns a local process talking MCP over stdio — the riskiest transport, flagged with a warning tone. */
function isLocalStdio(transport: McpServer['transport']): boolean {
  return transport === 'command'
}

async function usedByCounts(serverName: string, defs: Definition[], instances: InstanceView[]): Promise<{ usedByDefs: number; usedByInstances: number }> {
  const specs = await Promise.all(defs.map((d) => api.defGetSpec(d.id)))
  const usedByDefIds = new Set(
    defs
      .filter((_, i) => {
        const s = specs[i]
        return s.ok && s.data?.mcp?.mode === 'static' && s.data.mcp.servers.includes(serverName)
      })
      .map((d) => d.id)
  )
  const usedByInstances = instances.filter((inst) => inst.definitionId !== null && usedByDefIds.has(inst.definitionId)).length
  return { usedByDefs: usedByDefIds.size, usedByInstances }
}

function McpServerInspect({ name, state, onBack }: { name: string; state: InspectState; onBack: () => void }): JSX.Element {
  const t = useT()
  return (
    <section className="screen active">
      <button className="btn btn-ghost btn-sm" onClick={onBack}>{t('mcp.back')}</button>
      <h2 className="section-title" style={{ marginTop: 'var(--space-3)' }}>{name}</h2>

      {state.status === 'loading' && <p className="section-desc">{t('mcp.loading')}</p>}

      {state.status === 'error' && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
          <p className="section-desc" style={{ color: 'var(--danger)', marginBottom: 0 }}>{t('mcp.error', { message: state.message })}</p>
        </div>
      )}

      {state.status === 'ready' && (
        <table className="review-table">
          <tbody>
            <tr><td>{t('mcp.inspectType')}</td><td>{t(`mcp.transport.${state.detail.transport}`)}</td></tr>
            <tr><td>{t('mcp.inspectEndpoint')}</td><td><span className="code-inline">{redactMcpEndpoint(state.detail.endpoint)}</span></td></tr>
            <tr><td>{t('mcp.inspectAuth')}</td><td><McpAuthBadge state={state.auth} /></td></tr>
            <tr><td>{t('mcp.inspectConnectivity')}</td><td>{state.detail.tools !== undefined ? t('mcp.connected') : t('mcp.connectivityUnknown')}</td></tr>
            <tr><td>{t('mcp.usedBy')}</td><td>{t('mcp.usedByCount', { defs: state.usedByDefs, instances: state.usedByInstances })}</td></tr>
          </tbody>
        </table>
      )}
    </section>
  )
}

export function McpServers({ defs, instances }: { defs: Definition[]; instances: InstanceView[] }): JSX.Element {
  const t = useT()
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [inspectName, setInspectName] = useState<string | null>(null)
  const [inspect, setInspect] = useState<InspectState | null>(null)

  const load = useCallback(async () => {
    setList({ status: 'loading' })
    const r = await api.mcpList()
    if (!r.ok) { setList({ status: 'error', message: r.error.message }); return }
    const servers = r.data
    const authResults = await Promise.all(servers.map((s) => api.mcpAuthStatus(s.name)))
    const auth: Record<string, McpAuthState> = {}
    servers.forEach((s, i) => { const a = authResults[i]; auth[s.name] = a.ok ? a.data : 'unknown' })
    setList({ status: 'ready', servers, auth })
  }, [])

  useEffect(() => { void load() }, [load])

  const openInspect = useCallback(async (name: string) => {
    setInspectName(name)
    setInspect({ status: 'loading' })
    const [detailR, authR, counts] = await Promise.all([api.mcpInspect(name), api.mcpAuthStatus(name), usedByCounts(name, defs, instances)])
    if (!detailR.ok) { setInspect({ status: 'error', message: detailR.error.message }); return }
    setInspect({
      status: 'ready',
      detail: detailR.data,
      auth: authR.ok ? authR.data : 'unknown',
      ...counts
    })
  }, [defs, instances])

  if (inspectName) {
    return <McpServerInspect name={inspectName} state={inspect ?? { status: 'loading' }} onBack={() => { setInspectName(null); setInspect(null) }} />
  }

  return (
    <section className="screen active">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title" style={{ marginBottom: 0 }}>{t('mcp.title')}</h2>
        <button className="btn btn-secondary" onClick={() => void load()}>{t('mcp.refresh')}</button>
      </div>
      <p className="section-desc">{t('mcp.subtitle')}</p>

      {list.status === 'loading' && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
          <p className="section-desc" style={{ marginBottom: 0 }}>{t('mcp.loading')}</p>
        </div>
      )}

      {list.status === 'error' && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
          <p className="section-desc" style={{ color: 'var(--danger)' }}>{t('mcp.error', { message: list.message })}</p>
          <button className="btn btn-secondary" onClick={() => void load()}>{t('mcp.retry')}</button>
        </div>
      )}

      {list.status === 'ready' && list.servers.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
          <p className="section-desc">{t('mcp.empty')}</p>
          <p className="section-desc" style={{ marginBottom: 0 }}>{t('mcp.emptyCta')} <span className="code-inline">sbx mcp add …</span></p>
        </div>
      )}

      {list.status === 'ready' && list.servers.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t('mcp.colName')}</th><th>{t('mcp.colType')}</th><th>{t('mcp.colEndpoint')}</th><th>{t('mcp.colAuth')}</th><th>{t('mcp.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.servers.map((s) => (
                <tr key={s.name}>
                  <td style={{ fontWeight: 510 }}>{s.name}</td>
                  <td><span className={`badge ${isLocalStdio(s.transport) ? 'tier-balanced' : 'badge-stopped'}`}>{t(`mcp.transport.${s.transport}`)}</span></td>
                  <td><span className="code-inline">{redactMcpEndpoint(s.endpoint)}</span></td>
                  <td><McpAuthBadge state={list.auth[s.name] ?? 'unknown'} /></td>
                  <td><button className="btn btn-secondary btn-sm" onClick={() => void openInspect(s.name)}>{t('mcp.inspect')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
