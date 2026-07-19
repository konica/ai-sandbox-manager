import type { PolicyEvent, PolicySummary } from '@shared/types'

const EMPTY: PolicySummary = { allowed: 0, blocked: 0, events: [] }

interface RawRow { host?: unknown; reason?: unknown; last_seen?: unknown; count_since?: unknown }

function toEvents(rows: unknown, allowed: boolean): { events: PolicyEvent[]; count: number } {
  if (!Array.isArray(rows)) return { events: [], count: 0 }
  let count = 0
  const events: PolicyEvent[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as RawRow
    const host = typeof o.host === 'string' ? o.host : ''
    if (!host) continue
    const n = typeof o.count_since === 'number' ? o.count_since : 1
    count += n
    events.push({ at: typeof o.last_seen === 'string' ? o.last_seen : '', host, allowed, reason: typeof o.reason === 'string' ? o.reason : '' })
  }
  return { events, count }
}

/**
 * Parse `sbx policy log --json` — `{ allowed_hosts, blocked_hosts }` (Phase 0 spike shape).
 * `allowed`/`blocked` sum `count_since` (request counts); `events` merges both lists,
 * most-recent first. Tolerates empty/malformed input.
 */
export function parsePolicyLog(stdout: string): PolicySummary {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return EMPTY }
  if (!parsed || typeof parsed !== 'object') return EMPTY
  const o = parsed as Record<string, unknown>
  const a = toEvents(o.allowed_hosts, true)
  const b = toEvents(o.blocked_hosts, false)
  const events = [...a.events, ...b.events].sort((x, y) => y.at.localeCompare(x.at))
  return { allowed: a.count, blocked: b.count, events }
}
