export const MAX_TAGS = 10
export const MAX_TAG_LEN = 32

/**
 * Normalise a raw tag list for storage/display: trim, drop empties, truncate each
 * to MAX_TAG_LEN, dedupe case-insensitively (first occurrence's casing wins), and
 * cap the count at MAX_TAGS. Total (never rejects) — malformed input is cleaned.
 */
export function normalizeTags(raw: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    const t = r.trim().slice(0, MAX_TAG_LEN)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= MAX_TAGS) break
  }
  return out
}
