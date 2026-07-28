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
}

// Verified via the Phase 0 spike (see src/main/kit/generate.ts CLAUDE_AGENT_DOMAINS/OAUTH_LOGIN_DOMAINS).
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
    sessionNameArgs: (name) => ['--name', name]
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
    sessionNameArgs: (name) => ['--session', name]
  },
  codex: {
    id: 'codex',
    keyword: 'codex',
    label: 'OpenAI Codex',
    // TODO: verify against the Codex CLI.
    domains: ['api.openai.com', 'chatgpt.com'],
    resumeArgs: ['--continue'],
    sessionNameArgs: () => []
  },
  copilot: {
    id: 'copilot',
    keyword: 'copilot',
    label: 'GitHub Copilot',
    // TODO: verify against the Copilot CLI.
    domains: ['github.com', '*.githubusercontent.com', 'copilot-proxy.githubusercontent.com'],
    resumeArgs: ['--continue'],
    sessionNameArgs: () => []
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
 * Best-effort agent for a (possibly custom) base image ref: matches a known built-in
 * variant's image-tag suffix, else 'claude' — the only agent that ever launched correctly
 * before this app supported others, so it's the safe default for anything unrecognized.
 */
export function agentFromBaseImage(baseImage: string): AgentId {
  for (const variant of Object.keys(VARIANT_AGENT) as BuiltinVariant[]) {
    if (baseImage.endsWith(`:${variant}`)) return VARIANT_AGENT[variant]
  }
  return 'claude'
}
