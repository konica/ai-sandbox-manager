/**
 * True when a custom-credential target is a shape `sbx secret set-custom --host` accepts: a bare
 * host, an IP literal, or one of sbx's wildcard patterns (`*.example.com`, `**.example.com`).
 *
 * sbx refuses anything carrying a scheme, port, or path —
 * `ERROR: invalid target "https://api.mem0.ai": expected host or IP without scheme/port` — and an
 * API base URL is the natural thing to paste out of a provider's docs. We reject that at the point
 * of entry and ask for the bare host rather than rewriting what was typed, so the value stored on
 * the definition is always the value the user saw.
 */

/** One host label: sbx's `*` / `**` wildcards, or a normal alphanumeric-and-hyphen label. */
const LABEL_RE = /^(?:\*{1,2}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/
/** A bracketed IPv6 literal — the form both sbx and URLs use. */
const IPV6_RE = /^\[[0-9a-f:.]+\]$/

export function isValidCredHost(raw: string): boolean {
  const host = raw.trim().toLowerCase()
  if (host === '') return false
  if (IPV6_RE.test(host)) return true
  return host.split('.').every((label) => LABEL_RE.test(label))
}

/**
 * Split a Host / Domain entry into the hosts it names. One custom secret often has to reach
 * several hosts (Google OAuth needs GOOGLE_CLIENT_SECRET on both accounts.google.com and
 * oauth2.googleapis.com), and sbx keys a custom secret by env var within a scope — so the
 * domains have to travel on ONE credential rather than one entry each.
 *
 * Commas and whitespace both separate, empties are dropped, and a repeat is dropped
 * case-insensitively (hosts are case-insensitive, and sbx should not be handed the same
 * `--host` twice) keeping the first spelling the user typed — we never rewrite their input.
 */
export function parseCredHosts(raw: string): string[] {
  const seen = new Set<string>()
  const hosts: string[] = []
  for (const token of raw.split(/[\s,]+/)) {
    const host = token.trim()
    if (!host) continue
    const key = host.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    hosts.push(host)
  }
  return hosts
}
