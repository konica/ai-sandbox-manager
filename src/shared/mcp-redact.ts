// Best-effort redaction for MCP server endpoint/command strings shown in the UI.
// Endpoints can carry secrets three ways: URL userinfo (user:pass@host), a query
// param whose name looks secret-bearing (api_key, token, …), or — for local/command
// transports — a `--flag value` / `KEY=value` token in the launch command. There is no
// structured secret field to redact instead, so this pattern-matches by name.

const SECRET_NAME_RE = /(key|token|secret|password|passwd|pwd|auth|credential|bearer)/i
const MASK = '••••'

function redactUrl(endpoint: string): string | null {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return null
  }
  let changed = false
  if (url.username) { url.username = MASK; changed = true }
  if (url.password) { url.password = MASK; changed = true }
  for (const key of url.searchParams.keys()) {
    if (SECRET_NAME_RE.test(key)) { url.searchParams.set(key, MASK); changed = true }
  }
  return changed ? url.toString() : endpoint
}

function redactCommand(command: string): string {
  return command.replace(/([\w.-]*(?:key|token|secret|password|passwd|pwd|auth|credential|bearer)[\w.-]*[=\s]+)(\S+)/gi, (_m, prefix: string) => `${prefix}${MASK}`)
}

/** Redact secret-bearing pieces of an MCP server's endpoint/command for display. Idempotent. */
export function redactMcpEndpoint(endpoint: string): string {
  if (!endpoint) return endpoint
  return redactUrl(endpoint) ?? redactCommand(endpoint)
}
