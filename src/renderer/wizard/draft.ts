import type { Tier, MountMode, CredentialRef, DefinitionSpec, PortProtocol, RegistryScope } from '@shared/types'
import { DEFAULT_SSH } from '@shared/types'
import type { AgentId, BuiltinVariant } from '@shared/agents'
import { AGENT_PROFILES, VARIANT_AGENT, agentFromBaseImage, matchedAgentFromBaseImage } from '@shared/agents'
import { needsProviderDomainWarning } from '@shared/provider-domain'
import { isValidCpus, isValidMemory, parseCpus, parseMemory } from '@shared/resources'
import type { McpMode } from '@shared/mcp'
export type { BuiltinVariant } from '@shared/agents'

// Draft credentials carry a transient plaintext `value` that is NEVER persisted to
// the spec — it is staged to the vault via IPC on submit (see App/CreateDefinition).
export interface DraftServiceCred {
  kind: 'service'
  serviceId: string
  envVar: string
  value: string
  fromEnv?: boolean // imported from the host env → value is fetched host-side at submit, not typed here
}
export interface DraftCustomCred {
  kind: 'custom'
  id: string
  label: string
  envVar: string
  domains: string[]
  value: string
}
export interface DraftRegistryCred {
  kind: 'registry'
  id: string
  host: string
  username: string
  scope: RegistryScope
  value: string // token/password — staged host-side on submit, never persisted to the spec
}
export type DraftCred = DraftServiceCred | DraftCustomCred | DraftRegistryCred

export const TOTAL_STEPS = 8

// Docker Sandboxes publishes built-in base images under this repository.
// Refs must include the docker.io host — sbx does not auto-resolve it.
export const TEMPLATE_REPO = 'docker.io/docker/sandbox-templates'

// Built-in base image templates offered in the wizard. These mirror the variants Docker
// publishes; every variant is wired to actually launch via its AGENT_PROFILES entry
// (src/shared/agents.ts). Each agent's launchArgs/resumeArgs were verified 2026-08-26 against
// the CLI's own source or docs; the per-agent `domains` lists remain unverified placeholders
// (see the TODO comments on each profile in agents.ts).
export interface VariantInfo { value: BuiltinVariant; label: string }
export const BUILTIN_VARIANTS: VariantInfo[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'claude-code-docker', label: 'claude-code-docker (docker-in-docker)' },
  { value: 'claude-code-minimal', label: 'Claude Code — minimal toolset (no Node.js, Python, Go, or Java)' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'OpenAI Codex' },
  { value: 'copilot', label: 'GitHub Copilot' }
]

export interface Draft {
  step: number
  name: string
  description: string
  imageChoice: BuiltinVariant | 'custom'
  agent: AgentId
  customImageRef: string
  workspace: string
  extraFolders: { path: string; mode: MountMode }[]
  tier: Tier
  domains: string[]
  ports: { hostPort: number | null; containerPort: number; protocol: PortProtocol; label: string }[]
  hostServices: { hostPort: number; label: string }[]
  copyFiles: { hostPath: string; sandboxPath: string }[]
  credentials: DraftCred[]
  mcpMode: McpMode
  mcpServers: string[]
  sshForwardAgent: boolean
  sshCommitSigning: boolean
  kitCommandsYaml: string
  cpus: string
  memory: string
}

export const initialDraft: Draft = {
  step: 1,
  name: '',
  description: '',
  imageChoice: 'claude-code',
  agent: 'claude',
  customImageRef: '',
  workspace: '',
  extraFolders: [],
  tier: 'locked',
  domains: [],
  ports: [],
  hostServices: [],
  copyFiles: [],
  credentials: [],
  mcpMode: 'off',
  mcpServers: [],
  sshForwardAgent: true,
  sshCommitSigning: false,
  kitCommandsYaml: '',
  cpus: '',
  memory: ''
}

export type DraftAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goToStep'; step: number }
  | { type: 'setField'; field: 'name' | 'description' | 'customImageRef' | 'workspace' | 'kitCommandsYaml' | 'cpus' | 'memory'; value: string }
  | { type: 'setImageChoice'; value: BuiltinVariant | 'custom' }
  | { type: 'setAgent'; value: AgentId }
  | { type: 'setTier'; tier: Tier }
  | { type: 'addExtraFolder'; path: string; mode: MountMode }
  | { type: 'removeExtraFolder'; index: number }
  | { type: 'setExtraFolderMode'; index: number; mode: MountMode }
  | { type: 'addDomain'; host: string }
  | { type: 'removeDomain'; host: string }
  | { type: 'addPort'; hostPort: number | null; containerPort: number; protocol: PortProtocol; label: string }
  | { type: 'removePort'; index: number }
  | { type: 'addHostService'; hostPort: number; label: string }
  | { type: 'removeHostService'; index: number }
  | { type: 'addCopyFile'; hostPath: string; sandboxPath: string }
  | { type: 'removeCopyFile'; index: number }
  | { type: 'addServiceCred'; serviceId: string; envVar: string; value: string; fromEnv?: boolean }
  | { type: 'addCustomCred'; cred: DraftCustomCred }
  | { type: 'addRegistryCred'; cred: DraftRegistryCred }
  | { type: 'removeCredential'; index: number }
  | { type: 'setMcpMode'; mode: McpMode }
  | { type: 'toggleMcpServer'; name: string }
  | { type: 'setSshForward'; value: boolean }
  | { type: 'setSshCommitSigning'; value: boolean }

export function draftReducer(d: Draft, a: DraftAction): Draft {
  switch (a.type) {
    case 'next': return { ...d, step: Math.min(TOTAL_STEPS, d.step + 1) }
    case 'back': return { ...d, step: Math.max(1, d.step - 1) }
    case 'goToStep': return { ...d, step: Math.min(TOTAL_STEPS, Math.max(1, a.step)) }
    case 'setField': {
      if (a.field === 'customImageRef') {
        // Auto-seed the agent from the typed custom ref when it matches a known built-in
        // variant suffix (e.g. "...:opencode") — this is what fixes the original bug where a
        // custom opencode/codex/copilot ref silently launched as `sbx create claude`. It is a
        // smart default, not a lock: matchedAgentFromBaseImage returns null for anything that
        // doesn't match a known suffix, in which case we leave d.agent untouched so we never
        // clobber a deliberate override just because the user is still mid-typing the ref.
        const matched = matchedAgentFromBaseImage(a.value)
        return { ...d, customImageRef: a.value, agent: matched ?? d.agent }
      }
      return { ...d, [a.field]: a.value }
    }
    case 'setImageChoice': return { ...d, imageChoice: a.value, agent: a.value === 'custom' ? d.agent : VARIANT_AGENT[a.value] }
    case 'setAgent': return { ...d, agent: a.value }
    case 'setTier': return { ...d, tier: a.tier }
    case 'addExtraFolder': return { ...d, extraFolders: [...d.extraFolders, { path: a.path, mode: a.mode }] }
    case 'removeExtraFolder': return { ...d, extraFolders: d.extraFolders.filter((_, i) => i !== a.index) }
    case 'setExtraFolderMode': return { ...d, extraFolders: d.extraFolders.map((f, i) => (i === a.index ? { ...f, mode: a.mode } : f)) }
    case 'addDomain': return d.domains.includes(a.host) ? d : { ...d, domains: [...d.domains, a.host] }
    case 'removeDomain': return { ...d, domains: d.domains.filter((h) => h !== a.host) }
    case 'addPort': return { ...d, ports: [...d.ports, { hostPort: a.hostPort, containerPort: a.containerPort, protocol: a.protocol, label: a.label }] }
    case 'removePort': return { ...d, ports: d.ports.filter((_, i) => i !== a.index) }
    case 'addHostService': return { ...d, hostServices: [...d.hostServices, { hostPort: a.hostPort, label: a.label }] }
    case 'removeHostService': return { ...d, hostServices: d.hostServices.filter((_, i) => i !== a.index) }
    case 'addCopyFile': return { ...d, copyFiles: [...d.copyFiles, { hostPath: a.hostPath, sandboxPath: a.sandboxPath }] }
    case 'removeCopyFile': return { ...d, copyFiles: d.copyFiles.filter((_, i) => i !== a.index) }
    case 'addServiceCred': return { ...d, credentials: [...d.credentials, { kind: 'service', serviceId: a.serviceId, envVar: a.envVar, value: a.value, fromEnv: a.fromEnv }] }
    case 'addCustomCred': return { ...d, credentials: [...d.credentials, a.cred] }
    case 'addRegistryCred': return { ...d, credentials: [...d.credentials, a.cred] }
    case 'removeCredential': return { ...d, credentials: d.credentials.filter((_, i) => i !== a.index) }
    case 'setMcpMode': return { ...d, mcpMode: a.mode }
    case 'toggleMcpServer': return { ...d, mcpServers: d.mcpServers.includes(a.name) ? d.mcpServers.filter((n) => n !== a.name) : [...d.mcpServers, a.name] }
    case 'setSshForward': return { ...d, sshForwardAgent: a.value, sshCommitSigning: a.value ? d.sshCommitSigning : false }
    case 'setSshCommitSigning': return { ...d, sshCommitSigning: a.value }
    default: return d
  }
}

export function resolveBaseImage(d: Draft): string {
  return d.imageChoice === 'custom' ? d.customImageRef.trim() : `${TEMPLATE_REPO}:${d.imageChoice}`
}

export function parsePort(input: string): { hostPort: number | null; containerPort: number } | null {
  const t = input.trim()
  const explicit = t.match(/^(\d+):(\d+)$/)
  if (explicit) return { hostPort: Number(explicit[1]), containerPort: Number(explicit[2]) }
  const bare = t.match(/^(\d+)$/)
  if (bare) return { hostPort: null, containerPort: Number(bare[1]) }
  return null
}

// Basename of a path, tolerating trailing slashes and both separators.
export function basename(p: string): string {
  const trimmed = p.trim().replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).pop() ?? ''
}

// The sandbox name defaults to the working directory's folder name when the
// user leaves the name blank.
export function effectiveName(d: Draft): string {
  return d.name.trim() || basename(d.workspace)
}

export function canAdvance(d: Draft): boolean {
  // Step 1 merges name/description/workspace; the working directory is required
  // (the name is derived from it when blank).
  if (d.step === 1) return d.workspace.trim().length > 0
  if (d.step === 2) return resolveBaseImage(d).length > 0 && isValidCpus(d.cpus) && isValidMemory(d.memory)
  return true
}

/** True when the chosen agent ships no domains of its own and nothing else will make the
 * sandbox reachable — the user must add their model provider's domain or the agent can't
 * reach any inference endpoint. Thin Draft-shaped wrapper over the shared predicate in
 * src/shared/provider-domain.ts, which is also used by the def:import warning (src/main/ipc.ts)
 * — keep the actual condition there, not duplicated here. */
export function needsProviderDomainHint(d: Draft): boolean {
  return needsProviderDomainWarning(d.agent, d.tier, d.domains.length)
}

/** Reverse of toSpec: seed the wizard draft from a stored definition for editing. */
export function draftFromSpec(spec: DefinitionSpec): Draft {
  const primary = spec.mounts.find((m) => m.isPrimary) ?? spec.mounts[0]
  const extras = spec.mounts.filter((m) => m !== primary)
  const knownVariant = BUILTIN_VARIANTS.find((v) => `${TEMPLATE_REPO}:${v.value}` === spec.definition.baseImage)
  return {
    step: 1,
    name: spec.definition.name,
    description: spec.definition.description,
    imageChoice: knownVariant ? knownVariant.value : 'custom',
    agent: spec.definition.agent ?? agentFromBaseImage(spec.definition.baseImage),
    customImageRef: knownVariant ? '' : spec.definition.baseImage,
    workspace: primary?.hostPath ?? '',
    extraFolders: extras.map((m) => ({ path: m.hostPath, mode: m.mode })),
    tier: spec.definition.tier,
    domains: [...spec.domains],
    ports: spec.ports.map((p) => ({ ...p })),
    hostServices: spec.hostServices.map((hs) => ({ ...hs })),
    copyFiles: (spec.copyFiles ?? []).map((c) => ({ ...c })),
    credentials: spec.credentials.map((c): DraftCred => {
      if (c.kind === 'service') return { kind: 'service', serviceId: c.serviceId, envVar: c.envVar, value: '' }
      if (c.kind === 'registry') return { kind: 'registry', id: c.id, host: c.host, username: c.username ?? '', scope: c.scope, value: '' }
      return { kind: 'custom', id: c.id, label: c.label, envVar: c.envVar, domains: [...c.domains], value: '' }
    }),
    mcpMode: spec.mcp?.mode ?? 'off',
    mcpServers: spec.mcp?.servers ? [...spec.mcp.servers] : [],
    sshForwardAgent: (spec.ssh ?? DEFAULT_SSH).forwardAgent,
    sshCommitSigning: (spec.ssh ?? DEFAULT_SSH).commitSigning,
    kitCommandsYaml: spec.kitCommandsYaml ?? '',
    cpus: spec.definition.cpus != null ? String(spec.definition.cpus) : '',
    memory: spec.definition.memory ?? ''
  }
}

export function toSpec(d: Draft, id: string, createdAt: string): DefinitionSpec {
  return {
    definition: { id, name: effectiveName(d), description: d.description.trim(), agent: d.agent, baseImage: resolveBaseImage(d), tier: d.tier, createdAt, cpus: parseCpus(d.cpus), memory: parseMemory(d.memory) },
    mounts: [
      { hostPath: d.workspace.trim(), mode: 'direct', isPrimary: true }, // primary workspace is always direct (read-write bind)
      ...d.extraFolders.map((f) => ({ hostPath: f.path, mode: f.mode, isPrimary: false }))
    ],
    domains: d.domains,
    ports: d.ports,
    hostServices: d.hostServices,
    copyFiles: d.copyFiles.filter((c) => c.hostPath.trim() && c.sandboxPath.trim()).map((c) => ({ hostPath: c.hostPath.trim(), sandboxPath: c.sandboxPath.trim() })),
    credentials: d.credentials.map((c): CredentialRef => {
      if (c.kind === 'service') return { kind: 'service', serviceId: c.serviceId, envVar: c.envVar, store: 'sbx' }
      if (c.kind === 'registry') return { kind: 'registry', id: c.id, host: c.host, username: c.username.trim() || undefined, scope: c.scope, store: 'sbx' }
      return { kind: 'custom', id: c.id, label: c.label, envVar: c.envVar, domains: c.domains, store: 'encrypted' }
    }),
    mcp: d.mcpMode === 'off' ? undefined : { mode: d.mcpMode, servers: d.mcpMode === 'static' ? d.mcpServers : [] },
    ssh: { forwardAgent: d.sshForwardAgent, commitSigning: d.sshForwardAgent && d.sshCommitSigning },
    kitCommandsYaml: d.kitCommandsYaml.trim() ? d.kitCommandsYaml : undefined
  }
}
