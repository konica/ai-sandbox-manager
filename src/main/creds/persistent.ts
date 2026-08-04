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
 * - service → every known env var of the service (e.g. GH_TOKEN + GITHUB_TOKEN), value = sentinel
 * - custom  → its single env var, value = sentinel
 * - registry → none (registry auth has no in-VM env var; applies only at image pull)
 * The real value continues to flow through the host-side proxy; the sentinel just makes the
 * variable present so tools inside the sandbox see a non-empty value.
 */
export function credentialEnvVars(c: CredentialRef): { name: string; value: string }[] {
  if (c.kind === 'service') {
    const svc = serviceById(c.serviceId)
    const names = svc && svc.envVars.length > 0 ? svc.envVars : [c.envVar]
    const value = svc?.sentinel ?? DEFAULT_SENTINEL
    return names.filter((n) => VALID_ENV.test(n)).map((name) => ({ name, value }))
  }
  if (c.kind === 'custom') {
    return VALID_ENV.test(c.envVar) ? [{ name: c.envVar, value: DEFAULT_SENTINEL }] : []
  }
  return []
}

/** The full managed block (markers + sorted, deduped exports) for a definition's credentials. */
export function buildManagedBlock(credentials: CredentialRef[]): string {
  const seen = new Set<string>()
  const lines = credentials
    .flatMap(credentialEnvVars)
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
 */
export function persistentEnvScript(credentials: CredentialRef[], file = PERSISTENT_FILE): string {
  return [
    `touch ${file}`,
    `sed -i '/^${MANAGED_BEGIN}$/,/^${MANAGED_END}$/d' ${file}`,
    `[ -s ${file} ] && [ "$(tail -c1 ${file})" != "" ] && printf '\n' >> ${file}`,
    `cat >> ${file} <<'SBXMGR_EOF'`,
    buildManagedBlock(credentials),
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
