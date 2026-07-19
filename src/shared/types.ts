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

export type PortProtocol = 'tcp' | 'tcp4' | 'tcp6'

export interface PortIntent {
  hostPort: number | null // null = ephemeral (OS allocates the host port)
  containerPort: number
  protocol: PortProtocol
  label: string
}

/** A service on the host the sandbox should reach via host.docker.internal:<port>. */
export interface HostServiceIntent {
  hostPort: number
  label: string
}

/** A live port forward on a running sandbox (from `sbx ports --json`). */
export interface LivePort {
  hostPort: number | null
  containerPort: number
  protocol: string
}

export type CredentialStore = 'sbx' | 'encrypted'

/** A built-in service (anthropic, openai, …). Value lives in sbx keychain; base kit owns serviceAuth. */
export interface ServiceCredentialRef {
  kind: 'service'
  serviceId: string
  envVar: string
  store: CredentialStore
}

/**
 * An arbitrary service. Injected at runtime via `sbx secret set-custom` (verified in the
 * Phase 0 spike): the proxy substitutes a generated placeholder for the real value in any
 * outbound request to a matching host. The agent chooses which header carries the env var —
 * so there is no app-supplied header name / value format.
 */
export interface CustomCredentialRef {
  kind: 'custom'
  id: string // slug — lowercase/alnum/hyphen, unique within a definition
  label: string
  envVar: string // in-VM env var set to the placeholder (--env)
  domains: string[] // target hosts (--host); wildcards *. / **. allowed
  store: CredentialStore
}

export type CredentialRef = ServiceCredentialRef | CustomCredentialRef

/** A host env var found for a known service during import scanning. Value is masked. */
export interface EnvHit {
  serviceId: string
  label: string
  envVar: string
  masked: string
}

/** A reusable secret managed in Settings (sbx `-g`). Metadata only — never the value. */
export interface GlobalSecretMeta {
  id: string // service id, or a custom slug
  label: string
  envVar: string
  store: CredentialStore
  createdAt: string
}

export interface DefinitionSpec {
  definition: Definition
  mounts: MountIntent[]
  domains: string[]
  ports: PortIntent[]
  hostServices: HostServiceIntent[]
  credentials: CredentialRef[]
}

export interface InstanceView extends SbxInstance {
  definitionId: string | null
  definitionName: string | null
  tier: Tier | 'custom'
}

// Structured prerequisite result. The main process reports the id, pass/fail,
// and raw values only; the renderer composes translated labels/details.
export interface PrereqCheck {
  id: 'docker' | 'sbx' | 'auth' | 'disk' | 'keychain'
  ok: boolean
  value?: string // docker/sbx version text
  freeGiB?: string // formatted free disk, e.g. "41.4"
}

export interface PrereqResult {
  ok: boolean
  checks: PrereqCheck[]
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { kind: string; message: string } }
