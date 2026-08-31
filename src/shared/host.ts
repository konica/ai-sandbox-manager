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
