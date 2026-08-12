import type { McpServer, McpServerDetail, McpTransport, McpAuthState } from '@shared/mcp'

function toTransport(raw: unknown): McpTransport {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === 'remote' || s === 'local' || s === 'command') return s
  return 'command'
}

/** Parse `sbx mcp ls --json` (bare array, or `{ servers: [...] }` envelope). Throws if not valid JSON. */
export function parseMcpLsJson(stdout: string): McpServer[] {
  const parsed = JSON.parse(stdout) as unknown
  return extractRows(parsed).map((r) => ({
    name: String(r.name ?? ''),
    transport: toTransport(r.type ?? r.transport),
    endpoint: String(r.url ?? r.command ?? r.endpoint ?? ''),
    scopes: toScopes(r.scopes ?? r.scope)
  }))
}

function extractRows(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.servers)) return obj.servers as Array<Record<string, unknown>>
  }
  return []
}

function toScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s)).filter(Boolean)
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

/**
 * Parse the whitespace-aligned `sbx mcp ls` table (`NAME TYPE URL/COMMAND`, columns
 * separated by runs of 2+ spaces). Empty registry prints "No MCP servers registered".
 */
export function parseMcpLsText(stdout: string): McpServer[] {
  const lines = stdout.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  if (/no mcp servers registered/i.test(lines[0])) return []
  const header = lines[0].toUpperCase()
  const dataLines = header.startsWith('NAME') ? lines.slice(1) : lines
  return dataLines.map((line) => {
    const cols = line.split(/\s{2,}/).map((c) => c.trim())
    const [name = '', type = '', endpoint = ''] = cols
    return { name, transport: toTransport(type), endpoint, scopes: [] }
  })
}

/** Parse `sbx mcp inspect <name> --json`. Throws if not valid JSON. */
export function parseMcpInspectJson(stdout: string, fallbackName: string): McpServerDetail {
  const parsed = JSON.parse(stdout) as Record<string, unknown>
  return {
    name: String(parsed.name ?? fallbackName),
    transport: toTransport(parsed.type ?? parsed.transport),
    endpoint: String(parsed.url ?? parsed.command ?? parsed.endpoint ?? ''),
    scopes: toScopes(parsed.scopes ?? parsed.scope),
    tools: Array.isArray(parsed.tools) ? parsed.tools.map((t) => String(t)) : undefined,
    raw: stdout
  }
}

/**
 * Parse the `Key: value` lines of `sbx mcp inspect <name>` text output, e.g.:
 *   Name:      github
 *   Type:      local
 *   Command:   npx @modelcontextprotocol/server-github
 *   Resolved:  /usr/local/bin/npx @modelcontextprotocol/server-github
 * Unrecognized/empty output still resolves to a detail record (transport defaults to
 * 'command', endpoint '') carrying the raw text — never throws.
 */
export function parseMcpInspectText(stdout: string, fallbackName: string): McpServerDetail {
  const fields: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key) fields[key] = value
  }
  const endpoint = fields.url ?? fields.command ?? fields.resolved ?? ''
  const scopes = fields.scopes ? fields.scopes.split(',').map((s) => s.trim()).filter(Boolean) : []
  const tools = fields.tools ? fields.tools.split(',').map((s) => s.trim()).filter(Boolean) : undefined
  return {
    name: fields.name || fallbackName,
    transport: toTransport(fields.type),
    endpoint,
    scopes,
    tools,
    raw: stdout
  }
}

const AUTH_STATES: readonly McpAuthState[] = ['authorized', 'unauthorized', 'not-required', 'unknown']

function normalizeAuthState(raw: unknown): McpAuthState {
  if (typeof raw === 'boolean') return raw ? 'authorized' : 'unauthorized'
  const s = String(raw ?? '').trim().toLowerCase().replace(/_/g, '-')
  return (AUTH_STATES as string[]).includes(s) ? (s as McpAuthState) : 'unknown'
}

export interface McpAuthEntry { name: string; state: McpAuthState }

/**
 * Parse `sbx mcp auth status --all --format json`: a JSON array of per-server credential
 * status objects (empty registry → `[]`). Malformed/non-array input degrades to `[]`, never throws.
 */
export function parseMcpAuthStatusJson(stdout: string): McpAuthEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      name: String(r.name ?? ''),
      state: normalizeAuthState(r.status ?? r.state ?? (typeof r.authorized === 'boolean' ? r.authorized : undefined))
    }))
    .filter((e) => e.name !== '')
}

/** Parse the `NAME  STATUS` text fallback for `sbx mcp auth status`. Never throws. */
export function parseMcpAuthStatusText(stdout: string): McpAuthEntry[] {
  const lines = stdout.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  const header = lines[0].toUpperCase()
  const dataLines = header.startsWith('NAME') ? lines.slice(1) : lines
  return dataLines
    .map((line) => {
      const cols = line.split(/\s{2,}/).map((c) => c.trim())
      const [name = '', status = ''] = cols
      return { name, state: normalizeAuthState(status) }
    })
    .filter((e) => e.name !== '')
}
