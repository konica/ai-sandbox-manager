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

export type McpAddInput =
  | { transport: 'remote'; name: string; url: string; scopes: string[]; skipAuth?: boolean }
  | { transport: 'local'; name: string; metadataUrl: string; scopes: string[] }
  | { transport: 'command'; name: string; command: string; args: string[]; scopes: string[] }
