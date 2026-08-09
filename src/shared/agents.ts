export type AgentId = 'claude' | 'opencode' | 'codex' | 'copilot'

export type BuiltinVariant = 'claude-code' | 'claude-code-docker' | 'claude-code-minimal' | 'opencode' | 'codex' | 'copilot'

export interface AgentProfile {
  id: AgentId
  /** `sbx create <keyword> ...` positional. */
  keyword: string
  label: string
  /** Network domains this agent needs reachable — folded into every generated kit's allowlist. */
  domains: string[]
  /** Args appended after `sbx run`'s `--` separator to resume the last session. */
  resumeArgs: string[]
  /** Args appended after `sbx run`'s `--` separator to name a brand-new session. */
  sessionNameArgs: (name: string) => string[]
  /** Whether this agent supports MCP (Docker Sandboxes gateway). Verified via the Phase 0
   *  spike (#16): claude/codex/opencode = true, copilot = false. */
  mcpSupported: boolean
}

// Verified via the Phase 0 spike. `buildLoginKit`'s OAUTH_LOGIN_DOMAINS in
// src/main/kit/generate.ts is a deliberately smaller subset for the OAuth /login sandbox.
const CLAUDE_DOMAINS = [
  'api.anthropic.com', 'console.anthropic.com', 'claude.ai',
  'platform.claude.com', 'claude.com', 'downloads.claude.ai', 'mcp-proxy.anthropic.com'
]

export const AGENT_PROFILES: Record<AgentId, AgentProfile> = {
  claude: {
    id: 'claude',
    keyword: 'claude',
    label: 'Claude Code',
    domains: CLAUDE_DOMAINS,
    resumeArgs: ['--continue'],
    sessionNameArgs: (name) => ['--name', name],
    mcpSupported: true
  },
  opencode: {
    id: 'opencode',
    keyword: 'opencode',
    label: 'OpenCode',
    // TODO: verify against the opencode CLI. opencode is multi-provider (Anthropic, OpenAI,
    // local models, …) — there's no single fixed domain list, so this ships empty and users
    // add their configured provider's domain via the wizard's custom-domains field instead.
    domains: [],
    resumeArgs: ['--continue'],
    sessionNameArgs: (name) => ['--session', name],
    mcpSupported: true
  },
  codex: {
    id: 'codex',
    keyword: 'codex',
    label: 'OpenAI Codex',
    // TODO: verify against the Codex CLI.
    domains: ['api.openai.com', 'chatgpt.com'],
    resumeArgs: ['--continue'],
    sessionNameArgs: () => [],
    mcpSupported: true
  },
  copilot: {
    id: 'copilot',
    keyword: 'copilot',
    label: 'GitHub Copilot',
    // TODO: verify against the Copilot CLI.
    domains: ['github.com', '*.githubusercontent.com', 'copilot-proxy.githubusercontent.com'],
    resumeArgs: ['--continue'],
    sessionNameArgs: () => [],
    mcpSupported: false
  }
}

export const VARIANT_AGENT: Record<BuiltinVariant, AgentId> = {
  'claude-code': 'claude',
  'claude-code-docker': 'claude',
  'claude-code-minimal': 'claude',
  opencode: 'opencode',
  codex: 'codex',
  copilot: 'copilot'
}

/**
 * Matches a (possibly custom) base image ref against a known built-in variant's image-tag
 * suffix. Returns null when nothing matches — unlike agentFromBaseImage, this does NOT fold
 * "no match" into a 'claude' default, so callers that need to tell "genuinely matched" apart
 * from "fell back to the default" (e.g. auto-seeding the wizard's agent field from a custom
 * ref without clobbering a deliberate user override) can do so.
 */
export function matchedAgentFromBaseImage(baseImage: string): AgentId | null {
  for (const variant of Object.keys(VARIANT_AGENT) as BuiltinVariant[]) {
    if (baseImage.endsWith(`:${variant}`)) return VARIANT_AGENT[variant]
  }
  return null
}

/**
 * Best-effort agent for a (possibly custom) base image ref: matches a known built-in
 * variant's image-tag suffix, else 'claude' — the only agent that ever launched correctly
 * before this app supported others, so it's the safe default for anything unrecognized.
 */
export function agentFromBaseImage(baseImage: string): AgentId {
  return matchedAgentFromBaseImage(baseImage) ?? 'claude'
}
