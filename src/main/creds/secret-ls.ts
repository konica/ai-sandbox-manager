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
  // Only scan rows in the CUSTOM SECRETS section — the services section above it has no
  // PLACEHOLDER column, so never mine it for `sbx-cs-…` tokens.
  let inCustom = false
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    if (/^CUSTOM SECRETS\b/i.test(line)) { inCustom = true; continue }
    if (!inCustom) continue
    const tokens = line.split(/\s+/)
    // Anchor on the placeholder token; the token before it is ENV, tokens[0] is SCOPE. (A TARGETS
    // host that literally started with `sbx-cs-` would be matched first and drop that row — which
    // fails SAFE: the secret is omitted, never injected with a wrong value.)
    const idx = tokens.findIndex((t) => PLACEHOLDER_RE.test(t))
    // Need the placeholder AND a preceding ENV token AND a SCOPE at index 0; skip the header row.
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

/** What is actually registered for ONE sandbox: service names + custom {env, hosts}. Used by
 *  "Apply live" to remove secrets that were deleted from the definition. Only rows whose SCOPE
 *  column equals `scope` are included, so global (`(global)`) secrets are never touched. */
export interface InstanceSecrets {
  services: string[]
  /** `placeholder` is the only handle sbx offers for removing ONE custom secret — removing by
   *  host would take down every secret sharing that host. */
  customs: { env: string; hosts: string[]; placeholder: string }[]
}

export function parseInstanceSecrets(stdout: string, scope: string): InstanceSecrets {
  const services: string[] = []
  const customs: { env: string; hosts: string[]; placeholder: string }[] = []
  let inCustom = false
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    if (/^CUSTOM SECRETS\b/i.test(line)) { inCustom = true; continue }
    const tokens = line.split(/\s+/)
    if (!inCustom) {
      // Services section: SCOPE TYPE NAME SECRET. Take sandbox-scoped `service` rows (skip the
      // header row, whose 2nd token is "TYPE", and any (global) rows).
      if (tokens[0] === scope && tokens[1] === 'service' && tokens[2]) services.push(tokens[2])
      continue
    }
    // Custom section: SCOPE TARGETS… ENV PLACEHOLDER SECRET. Anchor on the placeholder token;
    // TARGETS are the tokens between SCOPE and ENV (a host may be comma-joined — split it).
    const idx = tokens.findIndex((t) => PLACEHOLDER_RE.test(t))
    if (idx < 2 || tokens[0] !== scope) continue
    const hosts = tokens.slice(1, idx - 1).flatMap((t) => t.split(',')).filter(Boolean)
    customs.push({ env: tokens[idx - 1], hosts, placeholder: tokens[idx] })
  }
  return { services, customs }
}
