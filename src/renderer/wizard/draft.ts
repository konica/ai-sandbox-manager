import type { Tier, MountMode, CredentialKind, DefinitionSpec } from '@shared/types'

export const TOTAL_STEPS = 7

export type BuiltinVariant = 'claude-code-docker' | 'claude-code' | 'claude-code-minimal' | 'claude-code-minimal-docker'

// Docker Sandboxes publishes built-in base images under this repository.
// Refs must include the docker.io host — sbx does not auto-resolve it.
export const TEMPLATE_REPO = 'docker.io/docker/sandbox-templates'

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
  credentials: { label: string; kind: CredentialKind }[]
}

export const initialDraft: Draft = {
  step: 1,
  name: '',
  description: '',
  imageChoice: 'claude-code-docker',
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
  | { type: 'addCredential'; label: string; kind: CredentialKind }
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
    case 'addCredential': return { ...d, credentials: [...d.credentials, { label: a.label, kind: a.kind }] }
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

export function canAdvance(d: Draft): boolean {
  if (d.step === 1) return d.name.trim().length > 0
  if (d.step === 2) return resolveBaseImage(d).length > 0
  if (d.step === 3) return d.workspace.trim().length > 0
  return true
}

export function toSpec(d: Draft, id: string, createdAt: string): DefinitionSpec {
  return {
    definition: { id, name: d.name.trim(), description: d.description.trim(), baseImage: resolveBaseImage(d), tier: d.tier, createdAt },
    mounts: [
      { hostPath: d.workspace.trim(), mode: d.workspaceMode, isPrimary: true },
      ...d.extraFolders.map((f) => ({ hostPath: f.path, mode: f.mode, isPrimary: false }))
    ],
    domains: d.domains,
    ports: d.ports,
    credentials: d.credentials
  }
}
