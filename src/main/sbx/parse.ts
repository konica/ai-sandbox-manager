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
  const data = JSON.parse(stdout) as Array<Record<string, unknown>>
  return data.map((r) => ({
    name: String(r.name ?? ''),
    status: toStatus(String(r.status ?? '')),
    agent: String(r.agent ?? ''),
    workspace: r.workspace ? String(r.workspace) : null,
    ports: Array.isArray(r.ports) ? (r.ports as unknown[]).map(String) : splitPorts(String(r.ports ?? ''))
  }))
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
