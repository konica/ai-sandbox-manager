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

export type CredentialStore = 'sbx' | 'encrypted'

/** A built-in service (anthropic, openai, …). Value lives in sbx keychain; base kit owns serviceAuth. */
export interface ServiceCredentialRef {
  kind: 'service'
  serviceId: string
  envVar: string
  store: CredentialStore
}

/** One proxy-rewritten header. `format` contains %s where the secret is substituted, e.g. "Bearer %s". */
export interface CustomHeader {
  name: string
  format: string
}

/** An arbitrary service. Injected via an app-generated mixin kit (serviceAuth four-block). */
export interface CustomCredentialRef {
  kind: 'custom'
  id: string // kit service id — lowercase/alnum/hyphen, unique within a definition
  label: string
  envVar: string // proxyManaged env var name inside the sandbox
  domains: string[] // serviceDomains keys; wildcards *. / **. allowed
  headers: CustomHeader[]
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
