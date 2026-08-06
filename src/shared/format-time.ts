/**
 * Human relative time for an ISO timestamp: "just now", "5 minutes ago", "3 hours ago",
 * "2 days ago". Returns null for null/empty/unparseable input so the caller renders its own
 * "unknown" text. Future timestamps (clock skew) are treated as "just now" — never negative.
 * `now` (ms) is injectable for deterministic tests; defaults to Date.now().
 */
export function formatRelativeTime(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const secs = Math.max(0, Math.floor((now - then) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}
