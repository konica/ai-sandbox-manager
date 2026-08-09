import type { AgentId } from './agents'

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
  agent: AgentId
  tier: Tier
  createdAt: string
  cpus?: number // optional CPU count; absent → sbx default (all host CPUs)
  memory?: string // optional binary-unit memory limit (e.g. '8g'); absent → sbx default
}

export interface InstanceMeta {
  sbxName: string
  definitionId: string | null
  createdByApp: boolean
  createdAt: string
  /** Credential fingerprint captured at create time; used to flag credential drift (→ rebuild). Null for pre-v7 rows. */
  credFingerprint?: string | null
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

/** A host file/dir to copy into the sandbox at launch via `sbx cp`. */
export interface CopyFileIntent {
  hostPath: string
  sandboxPath: string
}

/** A live port forward on a running sandbox (from `sbx ports --json`). */
export interface LivePort {
  hostPort: number | null
  containerPort: number
  protocol: string
}

/** One row of `sbx policy log` (allowed or blocked outbound request). */
export interface PolicyEvent {
  at: string
  host: string
  allowed: boolean
  reason: string
  proxyType: string // proxy handling: forward | forward-bypass | transparent | network | browser-open | '' (absent/unknown)
  count: number // requests to this host since it was first seen
}

/** Parsed `sbx policy log` — request counts + recent events. */
export interface PolicySummary {
  allowed: number
  blocked: number
  events: PolicyEvent[]
}

/** Claude Code host-side auth state (see src/main/auth). */
export type ClaudeAuthKind = 'oauth' | 'apikey' | 'none'
export interface AuthStatus { anthropic: ClaudeAuthKind }

/**
 * Per-definition SSH agent config. Forwarding is automatic in sbx when SSH_AUTH_SOCK
 * is set; forwardAgent=false opts out (launch strips SSH_AUTH_SOCK). commitSigning
 * configures git SSH signing inside the sandbox and requires forwardAgent=true.
 */
export interface SshConfig { forwardAgent: boolean; commitSigning: boolean }
export const DEFAULT_SSH: SshConfig = { forwardAgent: true, commitSigning: false }

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

/** Scope for a registry pull credential — maps to sbx secret set flags. */
export type RegistryScope = 'host' | 'global' | 'sandbox'

/**
 * Pull credential for a private OCI registry (verified in the Phase 0 spike):
 * `sbx secret set [-g | <SANDBOX>] --registry <host> [--username <u>] --password-stdin`.
 * The token never enters the sandbox filesystem — the proxy injects it into the registry
 * login. Scope decides where it applies: host-only (host pulls), global (`-g`, every
 * sandbox), or sandbox (`<name>` arg, one sandbox). Overwrite needs `-f`.
 */
export interface RegistryCredentialRef {
  kind: 'registry'
  id: string // slug from host — lowercase/alnum/hyphen, unique within a definition
  host: string // registry hostname, e.g. ghcr.io
  username?: string // optional; omit for token-only auth
  scope: RegistryScope
  store: CredentialStore
}

export type CredentialRef = ServiceCredentialRef | CustomCredentialRef | RegistryCredentialRef

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
  ssh?: SshConfig
  /** Optional custom kit `commands:` block (install/startup/initFiles), normalized. */
  kitCommandsYaml?: string
  /** Host files/dirs to copy into the sandbox at launch (sbx cp). */
  copyFiles?: CopyFileIntent[]
}

export interface InstanceView extends SbxInstance {
  definitionId: string | null
  definitionName: string | null
  tier: Tier | 'custom'
  /** The definition's credentials changed since this instance was created — rebuild to apply. */
  credsDrift?: boolean
  /** App-side tags assigned to this instance (empty when untagged). */
  tags: string[]
  /** ISO timestamp the app recorded (launch time; "first observed" for adopted/CLI instances;
   *  null when there is no metadata row). */
  createdAt: string | null
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

/** Advisory result of `sbx kit validate` on a user-supplied kit `commands:` block. */
export interface KitValidation {
  status: 'valid' | 'invalid' | 'unavailable'
  message: string
}

/** Where/how the app vault stores credentials on this host (for the Settings guide). */
export interface StorageStatus { platform: string; backend: string; secure: boolean }
