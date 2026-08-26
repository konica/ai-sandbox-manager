import type { SbxInstance, SbxStatus, LivePort } from '@shared/types'

function toStatus(raw: string): SbxStatus {
  const s = raw.toLowerCase()
  if (s === 'running' || s === 'stopped' || s === 'error') return s
  return 'unknown'
}

function splitPorts(raw: string): string[] {
  const v = raw.trim()
  if (v === '' || v === '-' || v === '—') return []
  return v.split(',').map((p) => p.trim()).filter(Boolean)
}

/** Format one port entry (string or `{host_port, sandbox_port, protocol}` object) to `host->sandbox/proto`. */
function formatPort(p: unknown): string {
  if (typeof p === 'string') return p.trim()
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>
    const host = o.host_port ?? o.hostPort
    const sand = o.sandbox_port ?? o.sandboxPort ?? o.container_port ?? o.containerPort
    if (host == null && sand == null) return ''
    const h = host != null ? String(host) : '?'
    const s = sand != null ? String(sand) : h
    const base = h === s ? h : `${h}->${s}`
    return typeof o.protocol === 'string' && o.protocol ? `${base}/${o.protocol}` : base
  }
  return ''
}

/** Turn the `ports` field into readable strings, deduped (sbx lists one row per host IP family). */
function normalizePorts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return splitPorts(String(raw ?? ''))
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of raw) {
    const s = formatPort(p)
    if (s !== '' && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

/** Parse `sbx ls --json` output. Throws if not valid JSON. */
export function parseSbxLsJson(stdout: string): SbxInstance[] {
  const parsed = JSON.parse(stdout) as unknown
  return extractRows(parsed).map((r) => ({
    name: String(r.name ?? ''),
    status: toStatus(String(r.status ?? '')),
    agent: String(r.agent ?? ''),
    workspace: pickWorkspace(r),
    workspaces: allWorkspaces(r),
    ports: normalizePorts(r.ports)
  }))
}

/** `sbx ls --json` returns `{ sandboxes: [...] }`; also tolerate a bare array. */
function extractRows(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.sandboxes)) return obj.sandboxes as Array<Record<string, unknown>>
  }
  return []
}

/**
 * The complete mount list for a sandbox. `workspaces[]` is authoritative; a scalar
 * `workspace` yields a single-entry list. Returns undefined when the row carries neither,
 * so "unknown" stays distinguishable from "no mounts" — mount-drift detection must not
 * treat a missing field as an empty mount set.
 */
function allWorkspaces(r: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(r.workspaces)) return r.workspaces.map((w) => String(w))
  if (typeof r.workspace === 'string' && r.workspace !== '') return [r.workspace]
  return undefined
}

/** Prefer the first entry of `workspaces[]`; fall back to a scalar `workspace`. */
function pickWorkspace(r: Record<string, unknown>): string | null {
  if (Array.isArray(r.workspaces) && r.workspaces.length > 0) return String(r.workspaces[0])
  if (typeof r.workspace === 'string' && r.workspace !== '') return r.workspace
  return null
}

/** Parse the whitespace-aligned `sbx ls` table (columns separated by runs of 2+ spaces). */
export function parseSbxLsText(stdout: string): SbxInstance[] {
  const lines = stdout.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  const header = lines[0].toUpperCase()
  const dataLines = header.startsWith('SANDBOX') ? lines.slice(1) : lines
  return dataLines.map((line) => {
    const cols = line.split(/\s{2,}/).map((c) => c.trim())
    const [name = '', agent = '', status = '', ports = '', workspace = ''] = cols
    return {
      name,
      agent,
      status: toStatus(status),
      ports: splitPorts(ports),
      workspace: workspace === '' || workspace === '-' ? null : workspace
    }
  })
}

/**
 * Parse `sbx ports --json` (a bare array of {host_ip, host_port, sandbox_port, protocol})
 * into LivePort[], deduping the 127.0.0.1 + ::1 pair by (host_port, sandbox_port, protocol).
 * Tolerates a `{ ports: [...] }` envelope too.
 */
export function parsePortsJson(stdout: string): LivePort[] {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return [] }
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).ports))
      ? ((parsed as Record<string, unknown>).ports as unknown[])
      : []
  const seen = new Set<string>()
  const out: LivePort[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const host = o.host_port ?? o.hostPort
    const sand = o.sandbox_port ?? o.sandboxPort ?? o.container_port ?? o.containerPort
    if (sand == null) continue
    const hostPort = host == null ? null : Number(host)
    const containerPort = Number(sand)
    const protocol = typeof o.protocol === 'string' && o.protocol ? o.protocol : 'tcp'
    const key = `${hostPort}:${containerPort}/${protocol}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ hostPort, containerPort, protocol })
  }
  return out
}
