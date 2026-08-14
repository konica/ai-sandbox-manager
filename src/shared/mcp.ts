export type McpMode = 'off' | 'dynamic' | 'static'

/** servers is used only when mode === 'static' */
export interface McpBinding {
  mode: McpMode
  servers: string[]
}

export type McpTransport = 'remote' | 'local' | 'command'

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
