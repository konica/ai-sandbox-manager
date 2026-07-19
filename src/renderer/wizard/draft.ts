import type { Tier, MountMode, CredentialRef, DefinitionSpec } from '@shared/types'

// Draft credentials carry a transient plaintext `value` that is NEVER persisted to
// the spec — it is staged to the vault via IPC on submit (see App/CreateDefinition).
export interface DraftServiceCred {
  kind: 'service'
  serviceId: string
  envVar: string
  value: string
}
export interface DraftCustomCred {
  kind: 'custom'
  id: string
  label: string
  envVar: string
  domains: string[]
  headers: { name: string; format: string }[]
  value: string
}
export type DraftCred = DraftServiceCred | DraftCustomCred

export const TOTAL_STEPS = 6

export type BuiltinVariant = 'claude-code' | 'claude-code-minimal' | 'opencode' | 'codex' | 'copilot'

// Docker Sandboxes publishes built-in base images under this repository.
// Refs must include the docker.io host — sbx does not auto-resolve it.
export const TEMPLATE_REPO = 'docker.io/docker/sandbox-templates'

// Built-in base image templates offered in the wizard. These mirror the
// variants Docker publishes; only claude-code (or a custom template) is wired
// to actually launch at MVP — the others are selectable options.
export interface VariantInfo { value: BuiltinVariant; label: string }
export const BUILTIN_VARIANTS: VariantInfo[] = [
  { value: 'claude-code', label: 'Claude Code' },
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
  customImageRef: string
  workspace: string
  workspaceMode: MountMode
  extraFolders: { path: string; mode: MountMode }[]
  tier: Tier
  domains: string[]
  ports: { hostPort: number; containerPort: number; label: string }[]
  credentials: DraftCred[]
}

export const initialDraft: Draft = {
  step: 1,
  name: '',
  description: '',
  imageChoice: 'claude-code',
  customImageRef: '',
  workspace: '',
  workspaceMode: 'direct',
  extraFolders: [],
  tier: 'locked',
  domains: [],
  ports: [],
  credentials: []
}

export type DraftAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goToStep'; step: number }
  | { type: 'setField'; field: 'name' | 'description' | 'customImageRef' | 'workspace'; value: string }
  | { type: 'setImageChoice'; value: BuiltinVariant | 'custom' }
  | { type: 'setWorkspaceMode'; mode: MountMode }
  | { type: 'setTier'; tier: Tier }
  | { type: 'addExtraFolder'; path: string; mode: MountMode }
  | { type: 'removeExtraFolder'; index: number }
  | { type: 'addDomain'; host: string }
  | { type: 'removeDomain'; host: string }
  | { type: 'addPort'; hostPort: number; containerPort: number; label: string }
  | { type: 'removePort'; index: number }
  | { type: 'addServiceCred'; serviceId: string; envVar: string; value: string }
  | { type: 'addCustomCred'; cred: DraftCustomCred }
  | { type: 'removeCredential'; index: number }

export function draftReducer(d: Draft, a: DraftAction): Draft {
  switch (a.type) {
    case 'next': return { ...d, step: Math.min(TOTAL_STEPS, d.step + 1) }
    case 'back': return { ...d, step: Math.max(1, d.step - 1) }
    case 'goToStep': return { ...d, step: Math.min(TOTAL_STEPS, Math.max(1, a.step)) }
    case 'setField': return { ...d, [a.field]: a.value }
    case 'setImageChoice': return { ...d, imageChoice: a.value }
    case 'setWorkspaceMode': return { ...d, workspaceMode: a.mode }
    case 'setTier': return { ...d, tier: a.tier }
    case 'addExtraFolder': return { ...d, extraFolders: [...d.extraFolders, { path: a.path, mode: a.mode }] }
    case 'removeExtraFolder': return { ...d, extraFolders: d.extraFolders.filter((_, i) => i !== a.index) }
    case 'addDomain': return d.domains.includes(a.host) ? d : { ...d, domains: [...d.domains, a.host] }
    case 'removeDomain': return { ...d, domains: d.domains.filter((h) => h !== a.host) }
    case 'addPort': return { ...d, ports: [...d.ports, { hostPort: a.hostPort, containerPort: a.containerPort, label: a.label }] }
    case 'removePort': return { ...d, ports: d.ports.filter((_, i) => i !== a.index) }
    case 'addServiceCred': return { ...d, credentials: [...d.credentials, { kind: 'service', serviceId: a.serviceId, envVar: a.envVar, value: a.value }] }
    case 'addCustomCred': return { ...d, credentials: [...d.credentials, a.cred] }
    case 'removeCredential': return { ...d, credentials: d.credentials.filter((_, i) => i !== a.index) }
    default: return d
  }
}

export function resolveBaseImage(d: Draft): string {
  return d.imageChoice === 'custom' ? d.customImageRef.trim() : `${TEMPLATE_REPO}:${d.imageChoice}`
}

export function parsePort(input: string): { hostPort: number; containerPort: number } | null {
  const m = input.trim().match(/^(\d+):(\d+)$/)
  if (!m) return null
  return { hostPort: Number(m[1]), containerPort: Number(m[2]) }
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
  if (d.step === 2) return resolveBaseImage(d).length > 0
  return true
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
    customImageRef: knownVariant ? '' : spec.definition.baseImage,
    workspace: primary?.hostPath ?? '',
    workspaceMode: primary?.mode ?? 'direct',
    extraFolders: extras.map((m) => ({ path: m.hostPath, mode: m.mode })),
    tier: spec.definition.tier,
    domains: [...spec.domains],
    ports: spec.ports.map((p) => ({ hostPort: p.hostPort, containerPort: p.containerPort, label: p.label })),
    credentials: spec.credentials.map((c): DraftCred =>
      c.kind === 'service'
        ? { kind: 'service', serviceId: c.serviceId, envVar: c.envVar, value: '' }
        : { kind: 'custom', id: c.id, label: c.label, envVar: c.envVar, domains: [...c.domains], headers: c.headers.map((h) => ({ ...h })), value: '' })
  }
}

export function toSpec(d: Draft, id: string, createdAt: string): DefinitionSpec {
  return {
    definition: { id, name: effectiveName(d), description: d.description.trim(), baseImage: resolveBaseImage(d), tier: d.tier, createdAt },
    mounts: [
      { hostPath: d.workspace.trim(), mode: d.workspaceMode, isPrimary: true },
      ...d.extraFolders.map((f) => ({ hostPath: f.path, mode: f.mode, isPrimary: false }))
    ],
    domains: d.domains,
    ports: d.ports,
    credentials: d.credentials.map((c): CredentialRef =>
      c.kind === 'service'
        ? { kind: 'service', serviceId: c.serviceId, envVar: c.envVar, store: 'sbx' }
        : { kind: 'custom', id: c.id, label: c.label, envVar: c.envVar, domains: c.domains, headers: c.headers, store: 'encrypted' })
  }
}
