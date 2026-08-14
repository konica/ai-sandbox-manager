export type McpMode = 'off' | 'dynamic' | 'static'

/** servers is used only when mode === 'static' */
export interface McpBinding {
  mode: McpMode
  servers: string[]
}

/**
 * 'server' is what sbx reports for a community-registry / server-manifest registration:
 * the OCI image runs inside the MCP gateway, so it is sandboxed — unlike 'command', which
 * spawns a process on the host. Keeping them distinct matters: they carry opposite
 * isolation guarantees.
 */
export type McpTransport = 'remote' | 'local' | 'command' | 'server'

export interface McpServer {
  name: string
  transport: McpTransport
  endpoint: string
  scopes: string[]
}

export interface McpServerDetail extends McpServer {
  tools?: string[]
  raw: string
}

export type McpAuthState = 'authorized' | 'unauthorized' | 'not-required' | 'unknown'

const MCP_REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0/servers'

/**
 * Build the community-registry URL that `sbx mcp add --url` resolves for a namespaced
 * registry server name. The slash MUST be percent-encoded — the nested-path form 404s.
 */
export function registryUrlForName(registryName: string): string {
  return `${MCP_REGISTRY_BASE}/${encodeURIComponent(registryName.trim())}/versions/latest`
}

/** A registry name is `<namespace>/<server>`, e.g. io.github.github/github-mcp-server. */
export function isRegistryServerName(value: string): boolean {
  const v = value.trim()
  return v !== '' && !/\s/.test(v) && !v.includes('://') && /^[^/]+\/[^/]+$/.test(v)
}

export interface PopularMcpServer {
  /** Display name for the one-click pick. */
  label: string
  /** Default value for the sandbox-side server name. */
  suggestedName: string
  registryName: string
}

/**
 * One-click picks so nobody has to hand-write a percent-encoded registry API URL — the
 * dead end that made GitHub unaddable from this screen.
 *
 * Entries are restricted to vendor-verified namespaces (`io.github.<org>` is GitHub-org
 * verified, `com.<domain>` is DNS verified) because the registry is full of look-alike
 * forks, e.g. io.github.crypto-ninja/github-mcp-server.
 *
 * Every entry here was verified twice against the live registry and CLI: the name resolves
 * 200, and `sbx mcp add --url <resolved>` actually registers. sbx rejects any manifest with
 * no OCI package ("no OCI package with a supported transport"), which rules out remote-only
 * and npm-only entries (Notion, Figma, Sentry all fail). Do not add an entry without
 * running both checks.
 */
export const POPULAR_MCP_SERVERS: readonly PopularMcpServer[] = [
  { label: 'GitHub', suggestedName: 'github', registryName: 'io.github.github/github-mcp-server' },
  { label: 'Grafana', suggestedName: 'grafana', registryName: 'io.github.grafana/mcp-grafana' },
  { label: 'Redis', suggestedName: 'redis', registryName: 'io.github.redis/mcp-redis' },
  { label: 'Terraform', suggestedName: 'terraform', registryName: 'io.github.hashicorp/terraform-mcp-server' }
]

/**
 * `clientId` is a PRE-REGISTERED OAuth client (`sbx mcp add --client-id`). It is required
 * for a remote server whose discovered OAuth metadata exposes no `registration_endpoint`,
 * so Dynamic Client Registration is impossible — GitHub's api.githubcopilot.com/mcp/ and
 * Slack both have this shape and cannot be registered without it.
 */
export type McpAddInput =
  | { transport: 'remote'; name: string; url: string; scopes: string[]; skipAuth?: boolean; clientId?: string }
  | { transport: 'local'; name: string; metadataUrl: string; scopes: string[] }
  | { transport: 'command'; name: string; command: string; args: string[]; scopes: string[] }
