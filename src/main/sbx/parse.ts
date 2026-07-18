import type { SbxInstance, SbxStatus } from '@shared/types'

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

/** Parse `sbx ls --json` output. Throws if not valid JSON. */
export function parseSbxLsJson(stdout: string): SbxInstance[] {
  const parsed = JSON.parse(stdout) as unknown
  return extractRows(parsed).map((r) => ({
    name: String(r.name ?? ''),
    status: toStatus(String(r.status ?? '')),
    agent: String(r.agent ?? ''),
    workspace: pickWorkspace(r),
    ports: Array.isArray(r.ports) ? (r.ports as unknown[]).map(String) : splitPorts(String(r.ports ?? ''))
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
