/**
 * Parse `sbx secret ls` output to recover the DYNAMIC per-sandbox placeholder that sbx generates
 * for each custom secret. Unlike built-in services (whose env-var placeholder is static), a custom
 * secret's in-VM value is a generated token like `sbx-cs-p8kRYpQbR2bGtkyO` that the host-side proxy
 * matches on outbound requests — so we must inject that exact token into /etc/sandbox-persistent.sh,
 * never a hardcoded sentinel.
 *
 * `sbx secret ls` prints two sections; only the CUSTOM SECRETS section carries a PLACEHOLDER column:
 *
 *   CUSTOM SECRETS
 *   SCOPE                 TARGETS            ENV                   PLACEHOLDER              SECRET
 *   my-sandbox-11a2d936   host.example.com   AZURE_OPENAI_API_KEY  sbx-cs-p8kRYpQbR2bGtkyO  GIx*…*i2cm
 *
 * We anchor on the `sbx-cs-…` token rather than fixed column offsets (spacing varies, TARGETS may
 * hold multiple hosts): the token before it is the ENV, the first token is the SCOPE. Service rows
 * and the header rows carry no `sbx-cs-…` token and are ignored.
 */

/** One CUSTOM SECRETS row: the dynamic placeholder for a custom secret's env var in one scope. */
export interface CustomSecretPlaceholder {
  scope: string
  env: string
  placeholder: string
}

// Custom-secret placeholders are emitted as `sbx-cs-<random>`; this anchors parsing.
const PLACEHOLDER_RE = /^sbx-cs-\S+$/

export function parseCustomSecretPlaceholders(stdout: string): CustomSecretPlaceholder[] {
  const out: CustomSecretPlaceholder[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const tokens = line.split(/\s+/)
    const idx = tokens.findIndex((t) => PLACEHOLDER_RE.test(t))
    // Need the placeholder AND a preceding ENV token AND a SCOPE at index 0.
    if (idx < 1) continue
    out.push({ scope: tokens[0], env: tokens[idx - 1], placeholder: tokens[idx] })
  }
  return out
}

/** ENV → dynamic placeholder for one sandbox scope (used to build the persistent-env block). */
export function customPlaceholdersForScope(stdout: string, scope: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of parseCustomSecretPlaceholders(stdout)) {
    if (row.scope === scope) map.set(row.env, row.placeholder)
  }
  return map
}
