import type { CredentialRef } from '@shared/types'
import { serviceById } from '@shared/services'
import { shellQuote } from '../sbx/translate'

/** Default in-VM placeholder for a proxy-managed credential (Docker sbx sentinel). */
export const DEFAULT_SENTINEL = 'proxy-managed'
export const MANAGED_BEGIN = '# >>> sandbox-manager (managed) >>>'
export const MANAGED_END = '# <<< sandbox-manager (managed) <<<'
export const PERSISTENT_FILE = '/etc/sandbox-persistent.sh'

// Only inject well-formed shell identifiers; anything else is skipped defensively.
const VALID_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The {name,value} env exports one credential contributes to the sandbox:
 * - service → every known env var of the service (e.g. GH_TOKEN + GITHUB_TOKEN), value = the
 *   service's STATIC sentinel (built-in services use a fixed placeholder).
 * - custom  → its single env var, value = the DYNAMIC per-sandbox placeholder sbx generated for it
 *   (looked up from `customPlaceholders`, keyed by env var). If we have no placeholder for it
 *   (not registered / not found in `sbx secret ls`), it is omitted — injecting a wrong token would
 *   silently break the proxy's substitution.
 * - registry → none (registry auth has no in-VM env var; applies only at image pull)
 * The real value continues to flow through the host-side proxy; the placeholder just makes the
 * variable present so tools inside the sandbox see the exact token the proxy matches on the wire.
 */
export function credentialEnvVars(
  c: CredentialRef,
  customPlaceholders?: Map<string, string>
): { name: string; value: string }[] {
  if (c.kind === 'service') {
    const svc = serviceById(c.serviceId)
    const names = svc && svc.envVars.length > 0 ? svc.envVars : [c.envVar]
    const value = svc?.sentinel ?? DEFAULT_SENTINEL
    return names.filter((n) => VALID_ENV.test(n)).map((name) => ({ name, value }))
  }
  if (c.kind === 'custom') {
    if (!VALID_ENV.test(c.envVar)) return []
    const placeholder = customPlaceholders?.get(c.envVar)
    return placeholder ? [{ name: c.envVar, value: placeholder }] : []
  }
  return []
}

/**
 * The full managed block (markers + sorted, deduped exports) for a definition's credentials.
 * `customPlaceholders` maps a custom secret's env var → its dynamic `sbx-cs-…` placeholder
 * (from `sbx secret ls`); custom creds without an entry are omitted (see credentialEnvVars).
 */
export function buildManagedBlock(credentials: CredentialRef[], customPlaceholders?: Map<string, string>): string {
  const seen = new Set<string>()
  const lines = credentials
    .flatMap((c) => credentialEnvVars(c, customPlaceholders))
    .filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `export ${p.name}=${shellQuote(p.value)}`)
  return [MANAGED_BEGIN, ...lines, MANAGED_END].join('\n')
}

/**
 * A POSIX sh snippet that (idempotently) removes any prior managed block and appends the current
 * one. Safe when the file or block is absent. Intended to run inside the sandbox via
 * `sbx exec <name> bash -lc <script>` — the whole string is one argv element, so the single
 * quotes here are literal characters the sandbox's bash parses, not host-shell quoting.
 * `customPlaceholders` carries the dynamic per-sandbox placeholders for custom secrets.
 */
export function persistentEnvScript(
  credentials: CredentialRef[],
  customPlaceholders?: Map<string, string>,
  file = PERSISTENT_FILE
): string {
  return [
    `touch ${file}`,
    `sed -i '/^${MANAGED_BEGIN}$/,/^${MANAGED_END}$/d' ${file}`,
    `[ -s ${file} ] && [ "$(tail -c1 ${file})" != "" ] && printf '\n' >> ${file}`,
    `cat >> ${file} <<'SBXMGR_EOF'`,
    buildManagedBlock(credentials, customPlaceholders),
    'SBXMGR_EOF'
  ].join('\n')
}

/** The `registry:` entries of a `credFingerprint` string (used to decide if drift may be cleared). */
export function registrySubset(fingerprint: string): string {
  return fingerprint
    .split('|')
    .filter((e) => e.startsWith('registry:'))
    .sort()
    .join('|')
}
