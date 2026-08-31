/**
 * Normalise a custom-credential target into the bare host `sbx secret set-custom --host` accepts.
 *
 * `sbx` rejects anything carrying a scheme or port —
 * `ERROR: invalid target "https://api.mem0.ai": expected host or IP without scheme/port` — but an
 * API base URL is the natural thing to paste out of a provider's docs, so accept that shape and
 * reduce it rather than failing the user's launch. Wildcard patterns (`*.example.com`,
 * `**.example.com`) are targets sbx documents, so they pass through untouched.
 *
 * Returns null when nothing usable is left, so callers can reject the input instead of handing
 * sbx a target it will refuse.
 */

/** One host label: sbx's `*` / `**` wildcards, or a normal alphanumeric-and-hyphen label. */
const LABEL_RE = /^(?:\*{1,2}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/
/** A bracketed IPv6 literal, kept bracketed — that is the form sbx and URLs both use. */
const IPV6_RE = /^\[[0-9a-f:.]+\]$/

export function normalizeCredHost(raw: string): string | null {
  let host = raw.trim().toLowerCase()
  if (host === '') return null
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
  host = host.replace(/^[^/@]*@/, '') // userinfo
  host = host.split(/[/?#]/)[0] // path, query, fragment (and any trailing slash)

  // A bracketed IPv6 literal holds colons of its own, so strip its port off the `]` — never by
  // the trailing-`:port` rule below, which would eat part of the address.
  const bracketed = /^(\[[^\]]*\])(?::\d+)?$/.exec(host)
  if (bracketed) return IPV6_RE.test(bracketed[1]) ? bracketed[1] : null

  host = host.replace(/:\d+$/, '') // port
  host = host.replace(/\.$/, '') // fully-qualified root dot
  if (host === '') return null
  return host.split('.').every((label) => LABEL_RE.test(label)) ? host : null
}
