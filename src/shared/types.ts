export type SbxStatus = 'running' | 'stopped' | 'error' | 'unknown'

export interface SbxInstance {
  name: string
  status: SbxStatus
  agent: string
  workspace: string | null
  ports: string[]
}

export type Tier = 'open' | 'balanced' | 'locked'

export interface Definition {
  id: string
  name: string
  description: string
  baseImage: string
  tier: Tier
  createdAt: string
}

export interface InstanceMeta {
  sbxName: string
  definitionId: string | null
  createdByApp: boolean
  createdAt: string
}

export type MountMode = 'direct' | 'clone'

export interface MountIntent {
  hostPath: string
  mode: MountMode
  isPrimary: boolean
}

export interface PortIntent {
  hostPort: number
  containerPort: number
  label: string
}

export type CredentialKind = 'git' | 'api-key' | 'claude-auth'

export interface CredentialRef {
  label: string
  kind: CredentialKind
}

export interface DefinitionSpec {
  definition: Definition
  mounts: MountIntent[]
  domains: string[]
  ports: PortIntent[]
  credentials: CredentialRef[]
}

export interface InstanceView extends SbxInstance {
  definitionId: string | null
  definitionName: string | null
  tier: Tier | 'custom'
}

export interface PrereqCheck {
  id: 'docker' | 'sbx' | 'auth' | 'disk' | 'keychain'
  label: string
  ok: boolean
  detail: string
  remediation?: string
}

export interface PrereqResult {
  ok: boolean
  checks: PrereqCheck[]
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { kind: string; message: string } }
