import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition, GlobalSecretMeta, EnvHit, LivePort, PolicySummary, AuthStatus, KitValidation, StorageStatus } from '@shared/types'
import type { ResourceStats } from '@shared/resource-stats'
import type { AgentId } from '@shared/agents'
import { AGENT_PROFILES } from '@shared/agents'
import { needsProviderDomainWarning } from '@shared/provider-domain'
import type { McpServer, McpServerDetail, McpAuthState, McpAddInput } from '@shared/mcp'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { checkPrereqs, type Probes } from './prereq'
import { reconcile, matchDefinitionByWorkspace } from './reconciler'
import { launchDefinition } from './launch'
import { SbxError } from '@shared/errors'
import { normalizeTags } from '@shared/tags'
import { registerCredentials } from './creds/register'
import { applyCredentialsLive } from './creds/apply-live'
import { agentAttachCommand, hostShellCommand, loginCommand, mcpAuthCommand, expandSandboxPath, expandHostPath } from './sbx/translate'
import type { SessionRestore } from './sbx/translate'
import { captureSessions, archivedSubdirs } from './session/archive'
import { fetchResourceStats } from './sbx/resource-stats'
import { claudeAuthStatus, claudeSignOut } from './auth/manager'
import { sshAgentPresent } from './ssh/detect'
import { readHostCapacity } from './host/capacity'
import { codeCliPresent } from './vscode'
import { buildExportBundle, parseImportBundle, dedupeName } from './defio/bundle'
import { randomUUID } from 'crypto'
import { scanEnv } from './creds/env-scan'
import { applyPortEdit, applyHostServiceEdit, applyDomainEdit } from './detail/persist'
import { serviceById } from '@shared/services'
import type { CredentialManager } from './creds/manager'
import type { Logger } from './log'
import { normalizeCommandsYaml } from '@shared/kit-commands'
import * as nodeFs from 'node:fs'
import os from 'node:os'
import { join, isAbsolute, resolve } from 'node:path'
import { resolveSandboxPath, basenameAny, posixJoin } from '@shared/copy'
import type { CopyDirection, ListResult, PlanResult, CopyResult } from '@shared/copy'
import type { CaptureSession } from './capture/session'
import { readBurpSettings, writeBurpSettings } from './capture/settings'
import { readCaFile, type CaInfo } from './capture/ca'
import { buildBurpUserConfig, BURP_CONFIG_FILENAME } from './capture/burp-config'
import type { BurpSettings, CaptureStatus } from '@shared/capture'

interface Deps {
  adapter: SbxAdapter
  store: Store
  probes: Probes
  openTerminal: (command: string) => void
  creds?: CredentialManager
  materializeKit?: (spec: DefinitionSpec, name: string) => string | undefined
  readLoginEnv?: () => Record<string, string | undefined>
  /** Override the host platform. Lets tests pin ssh:detect's behaviour on any dev machine. */
  platform?: NodeJS.Platform
  /** Override the Windows `ssh-add -l` agent probe (tests only). */
  sshProbe?: () => { status: number | null }
  loginKitDir?: () => string // materializes the OAuth login kit, returns its dir
  openVSCode?: (command: string, workspaceDir: string, sandboxName: string) => void
  genHash?: () => string
  /** Removes the generated <workspace>/.sandbox dir on instance removal (re-created at next launch). */
  cleanupKit?: (workspaceDir: string) => void
  saveFile?: (defaultName: string, contents: string) => Promise<string | null>
  openFile?: () => Promise<{ path: string; contents: string } | null>
  genId?: () => string
  log?: Logger
  /** Reports the app vault's at-rest storage status for the Settings guide. */
  storageStatus?: () => StorageStatus
  /** Override the clock (tests only) — drives the mcp:list short-lived cache. */
  now?: () => number
  /** Burp traffic-capture session manager. Absent in tests that do not exercise capture. */
  capture?: CaptureSession
  /** Override CA reading (tests only). */
  readCa?: (path: string) => CaInfo
  /** Root for Claude session archives (the app's userData dir). Absent ⇒ rebuild preserves nothing. */
  sessionArchiveBaseDir?: string
}

function requireCreds(deps: Deps): CredentialManager {
  if (!deps.creds) throw new Error('credential manager not configured')
  return deps.creds
}

/**
 * The in-sandbox capture port to inject into a shell opened on `name`, or undefined.
 *
 * Only a session that is actually `on` counts: one that is still starting, or that failed,
 * has no working relay, and pointing a shell at a dead port would cost it egress rather
 * than capture it. The sandbox must match too — only one capture session exists, so a
 * sibling sandbox has no relay of its own to reach.
 */
function capturePortFor(deps: Deps, name: string): number | undefined {
  const status = deps.capture?.status()
  if (!status || status.state !== 'on' || status.sandbox !== name) return undefined
  return status.ports?.app
}

function requireCapture(deps: Deps): CaptureSession {
  if (!deps.capture) throw new Error('traffic capture is not available in this session')
  return deps.capture
}

/**
 * Resolve the definition backing a live instance the same way the UI does: the app-written
 * metadata link first, then a workspace-path match (via the sandbox's `sbx ls` workspace) so
 * an instance started outside the app — e.g. from the sbx CLI — attaches/rebuilds like any
 * other. The `sbx ls` lookup only fires when there is no metadata, keeping app-created
 * instances on their existing single-lookup path.
 */
async function resolveInstanceDefinition(
  deps: Deps,
  name: string
): Promise<{ definitionId: string | null; spec: DefinitionSpec | null }> {
  const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
  let definitionId = meta?.definitionId ?? null
  if (!definitionId) {
    const inst = (await deps.adapter.listSandboxes()).find((i) => i.name === name)
    if (inst?.workspace) definitionId = matchDefinitionByWorkspace(deps.store, inst.workspace)?.id ?? null
  }
  const spec = definitionId ? deps.store.getDefinitionSpec(definitionId) : null
  return { definitionId, spec }
}

/** The agent to resume/attach with: the linked definition's own agent, or 'claude' when the
 * instance isn't tracked by the app (no definition to consult) — matching the app's
 * pre-multi-agent behavior for anything it doesn't manage. */
async function resolveAgentForInstance(deps: Deps, name: string): Promise<AgentId> {
  const { spec } = await resolveInstanceDefinition(deps, name)
  return spec?.definition.agent ?? 'claude'
}

/** Resolve a host path: absolute passes through; relative resolves against the default dir.
 * A leading `~`/`~/…` in either the input or the default dir is expanded to the OS home dir
 * first (`sbx cp`'s shell-quoter never expands `~` on its own). */
function resolveHostPath(defaultDir: string, input: string): string {
  const s = expandHostPath(input.trim())
  if (isAbsolute(s)) return resolve(s)
  return resolve(expandHostPath(defaultDir) || process.cwd(), s)
}

/** Resolve a sandbox path via the shared resolver, expanding `~` in both the default dir and
 * the final result — a `~`-relative default or input must never reach `sbx cp`/probes unexpanded. */
function resolveSandboxPathM(defaultDir: string, input: string): string {
  return expandSandboxPath(resolveSandboxPath(expandSandboxPath(defaultDir), input))
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    const err = e as { kind?: string; message?: string }
    return { ok: false, error: { kind: err.kind ?? 'generic', message: err.message ?? String(e) } }
  }
}

export function buildHandlers(deps: Deps): {
  'prereq:check': () => Promise<Result<PrereqResult>>
  'instances:list': () => Promise<Result<InstanceView[]>>
  'def:create': (spec: DefinitionSpec) => Promise<Result<{ id: string }>>
  'def:update': (spec: DefinitionSpec) => Promise<Result<{ id: string }>>
  'def:getSpec': (id: string) => Promise<Result<DefinitionSpec | null>>
  'def:list': () => Promise<Result<Definition[]>>
  'def:export': (ids: string[]) => Promise<Result<{ canceled?: boolean; path?: string; count?: number }>>
  'def:import': () => Promise<Result<{ canceled?: boolean; imported?: string[]; skipped?: number; domainWarnings?: string[] }>>
  'def:remove': (id: string) => Promise<Result<{ removedInstances: number }>>
  'instance:launch': (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[]) => Promise<Result<{ name: string }>>
  'instance:setTags': (name: string, tags: string[]) => Promise<Result<null>>
  'instance:attach': (name: string, opener?: 'terminal' | 'vscode') => Promise<Result<null>>
  'instance:rebuild': (name: string, opener?: 'terminal' | 'vscode') => Promise<Result<{ name: string }>>
  'instance:applyCredentials': (name: string) => Promise<Result<{ applied: number; removed: number; skipped: number }>>
  'instance:commands': (name: string) => Promise<Result<{ agent: string; shell: string }>>
  'instance:shell': (name: string) => Promise<Result<null>>
  'instance:stop': (name: string) => Promise<Result<null>>
  'instance:remove': (name: string) => Promise<Result<null>>
  'secret:listGlobal': () => Promise<Result<GlobalSecretMeta[]>>
  'secret:setGlobal': (serviceId: string, value: string) => Promise<Result<GlobalSecretMeta>>
  'secret:setGlobalFromEnv': (serviceId: string) => Promise<Result<GlobalSecretMeta>>
  'secret:removeGlobal': (id: string) => Promise<Result<null>>
  'cred:scanEnv': () => Promise<Result<EnvHit[]>>
  'cred:stageValue': (key: string, value: string) => Promise<Result<null>>
  'cred:stageFromEnv': (key: string, serviceId: string) => Promise<Result<null>>
  'instance:ports:list': (name: string) => Promise<Result<LivePort[]>>
  'instance:ports:publish': (name: string, port: LivePort) => Promise<Result<null>>
  'instance:ports:unpublish': (name: string, port: LivePort) => Promise<Result<null>>
  'instance:hostService:add': (name: string, hostPort: number, label: string) => Promise<Result<null>>
  'instance:hostService:remove': (name: string, hostPort: number) => Promise<Result<null>>
  'instance:domain:allow': (name: string, domain: string) => Promise<Result<null>>
  'instance:domain:deny': (name: string, domain: string) => Promise<Result<null>>
  'instance:policyLog': (name: string) => Promise<Result<PolicySummary>>
  'instance:stats': (name: string) => Promise<Result<ResourceStats>>
  'instance:fs:listDir': (name: string, path: string) => Promise<Result<ListResult>>
  'instance:fs:plan': (name: string, direction: CopyDirection, sources: string[], dest: string, defaults: { host: string; sandbox: string }) => Promise<Result<PlanResult>>
  'instance:fs:copy': (name: string, direction: CopyDirection, sources: string[], dest: string) => Promise<Result<CopyResult[]>>
  'auth:status': () => Promise<Result<AuthStatus>>
  'auth:signOut': () => Promise<Result<null>>
  'auth:startLogin': () => Promise<Result<{ name: string }>>
  'ssh:detect': () => Promise<Result<{ present: boolean; platform: string }>>
  'host:capacity': () => Promise<Result<{ cpuCores: number; totalMemBytes: number }>>
  'env:hasVSCode': () => Promise<Result<{ present: boolean }>>
  'kit:validate': (yaml: string) => Promise<Result<KitValidation>>
  'prefs:get': (key: string) => Promise<Result<string | null>>
  'prefs:set': (key: string, value: string) => Promise<Result<null>>
  'capture:status': () => Promise<Result<CaptureStatus>>
  'capture:enable': (name: string, force: boolean) => Promise<Result<CaptureStatus>>
  'capture:disable': () => Promise<Result<CaptureStatus>>
  'capture:settingsGet': () => Promise<Result<BurpSettings>>
  'capture:settingsSet': (patch: Partial<BurpSettings>) => Promise<Result<BurpSettings>>
  'capture:caInspect': (path: string) => Promise<Result<CaInfo>>
  'capture:burpConfig': () => Promise<Result<string>>
  'capture:exportConfig': () => Promise<Result<{ canceled?: boolean; path?: string }>>
  'creds:storageStatus': () => Promise<Result<StorageStatus>>
  'mcp:supported': () => Promise<Result<boolean>>
  'mcp:list': () => Promise<Result<McpServer[]>>
  'mcp:inspect': (name: string) => Promise<Result<McpServerDetail>>
  'mcp:add': (input: McpAddInput) => Promise<Result<null>>
  'mcp:remove': (name: string) => Promise<Result<null>>
  'mcp:authStatus': (name: string) => Promise<Result<McpAuthState>>
  'mcp:startAuth': (name: string) => Promise<Result<null>>
  'mcp:setClientSecret': (name: string, value: string) => Promise<Result<null>>
  'mcp:removeAuth': (name: string) => Promise<Result<null>>
} {
  // Deps for launchDefinition — shared by instance:launch and instance:rebuild.
  const launchDeps = () => ({
    adapter: deps.adapter,
    store: deps.store,
    creds: deps.creds ?? { getStaged: () => null },
    materializeKit: deps.materializeKit ?? (() => undefined),
    openTerminal: deps.openTerminal,
    openVSCode: deps.openVSCode,
    genHash: deps.genHash,
    log: deps.log
  })
  // Short-lived cache for mcp:list — the registry rarely changes and the panel polls it,
  // so avoid a `sbx mcp ls` spawn on every poll tick. Invalidated on add/remove.
  const now = deps.now ?? (() => Date.now())
  const MCP_LIST_CACHE_MS = 8000
  let mcpListCache: { at: number; data: McpServer[] } | null = null
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(async () => {
      const views = await reconcile(deps.adapter, deps.store)
      // The reconciler is the app's only poll: capture learns here that its sandbox
      // stopped or was rebuilt, and tears itself down. No separate timer exists.
      deps.capture?.onRunningInstances(views.filter((v) => v.status === 'running').map((v) => v.name))
      return views
    }),
    'def:create': (spec) => wrap(async () => { deps.store.insertDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:update': (spec) => wrap(async () => { deps.store.updateDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:getSpec': (id) => wrap(async () => deps.store.getDefinitionSpec(id)),
    'def:list': () => wrap(async () => deps.store.listDefinitions()),
    'def:export': (ids) => wrap(async () => {
      if (!deps.saveFile) throw new Error('file save not configured')
      const specs = ids.map((id) => deps.store.getDefinitionSpec(id)).filter((s): s is DefinitionSpec => s !== null)
      if (specs.length === 0) throw new Error('No definitions to export')
      const bundle = buildExportBundle(specs, new Date().toISOString())
      const defaultName = specs.length === 1
        ? `${specs[0].definition.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.sbx.json`
        : `sandbox-definitions-${specs.length}.sbx.json`
      const path = await deps.saveFile(defaultName, JSON.stringify(bundle, null, 2))
      if (!path) return { canceled: true }
      deps.log?.info(`Exported ${specs.length} definition(s) to ${path}`)
      return { path, count: specs.length }
    }),
    'def:import': () => wrap(async () => {
      if (!deps.openFile) throw new Error('file open not configured')
      const file = await deps.openFile()
      if (!file) return { canceled: true }
      const { definitions, skipped } = parseImportBundle(file.contents)
      const genId = deps.genId ?? randomUUID
      const existing = new Set(deps.store.listDefinitions().map((d) => d.name))
      const imported: string[] = []
      const domainWarnings: { name: string; agent: AgentId }[] = []
      for (const d of definitions) {
        const name = dedupeName(d.definition.name, existing)
        existing.add(name)
        // The wizard normally warns (needsProviderDomainHint) before a definition with zero
        // reachable domains can be saved, but def:import bypasses the wizard entirely — so an
        // imported opencode/locked-tier/no-domains bundle would otherwise generate a kit with
        // no network: block at all and no warning anywhere. Reuse the SAME shared predicate
        // here so there is one rule, not two divergent copies.
        if (needsProviderDomainWarning(d.definition.agent, d.definition.tier, d.domains.length)) {
          domainWarnings.push({ name, agent: d.definition.agent })
        }
        deps.store.insertDefinitionSpec({ ...d, definition: { ...d.definition, name, id: genId(), createdAt: new Date().toISOString() } })
        imported.push(name)
      }
      deps.log?.info(`Imported ${imported.length} definition(s)${skipped ? `, skipped ${skipped}` : ''} from ${file.path}`)
      for (const w of domainWarnings) {
        deps.log?.info(`⚠ Imported definition "${w.name}" (agent: ${AGENT_PROFILES[w.agent].label}) has no reachable network domains — it ships no built-in domains, uses the locked tier, and carries no custom domains. Add a domain (or widen the tier) before launching, or the agent won't be able to reach its provider.`)
      }
      return { imported, skipped, domainWarnings: domainWarnings.length > 0 ? domainWarnings.map((w) => w.name) : undefined }
    }),
    'def:remove': (id) => wrap(async () => {
      // Remove every instance launched from this definition (best-effort each), then the definition.
      const instances = deps.store.listInstanceMeta().filter((m) => m.definitionId === id)
      for (const m of instances) {
        try { await cleanupInstance(deps, m.sbxName) }
        catch (e) { deps.log?.error(`Could not remove instance "${m.sbxName}" while deleting its definition: ${(e as Error).message}`) }
      }
      deps.store.deleteDefinition(id)
      deps.log?.info(`Deleted definition ${id} and ${instances.length} instance(s).`)
      return { removedInstances: instances.length }
    }),
    'instance:launch': (definitionId, name, sessionName, opener, tags) => wrap(() => launchDefinition(
      launchDeps(),
      definitionId, name, sessionName, opener ?? 'terminal', tags ?? []
    )),
    'instance:setTags': (name, tags) => wrap(async () => { deps.store.setInstanceTags(name, normalizeTags(tags)); return null }),
    'instance:attach': (name, opener) => wrap(async () => {
      const { definitionId, spec } = await resolveInstanceDefinition(deps, name)
      const cmd = agentAttachCommand(name, spec?.definition.agent ?? 'claude', capturePortFor(deps, name))
      // Re-register the definition's current credentials scoped to this instance so any
      // added/changed since the initial launch are synced into sbx before the agent runs.
      if (spec && deps.creds && definitionId && spec.credentials.length > 0) {
        await registerCredentials({ adapter: deps.adapter, creds: deps.creds, log: deps.log }, definitionId, spec.credentials, name)
      }
      const workspaceDir = (spec?.mounts.find((m) => m.isPrimary) ?? spec?.mounts[0])?.hostPath?.trim()
      if (opener === 'vscode') {
        // Never answer an explicit VS Code request by opening a terminal instead. VS Code is
        // opened on a host folder (the sandbox's own files aren't on the host), so with no
        // resolvable mount there is nothing to open — report that rather than substituting a
        // different opener, which looked like "VS Code doesn't work" with no explanation.
        if (!workspaceDir) {
          throw new SbxError('not-found', spec
            ? `Instance "${name}" has no host folder to open in VS Code — its definition has no working directory. Use Open Agent in Terminal instead.`
            : `Instance "${name}" has no linked definition, so there is no host folder to open in VS Code. Use Open Agent in Terminal instead.`)
        }
        if (!deps.openVSCode) throw new SbxError('generic', 'The VS Code opener is unavailable on this platform.')
        deps.log?.info(`Opening VS Code at ${workspaceDir} to attach "${name}"`)
        deps.openVSCode(cmd, workspaceDir, name)
      } else {
        deps.log?.info(`Opening agent terminal: ${cmd}`)
        deps.openTerminal(cmd)
      }
      return null
    }),
    'instance:rebuild': (name, opener) => wrap(async () => {
      // Recreate the sandbox from its definition so config/credential changes (e.g. new
      // custom-secret env vars, only injected at create time) take effect. Removes the old
      // sandbox + its scoped secrets/.sandbox, then launches a fresh instance.
      const { definitionId } = await resolveInstanceDefinition(deps, name)
      if (!definitionId) throw new SbxError('not-found', `Instance "${name}" has no linked definition to rebuild from.`)
      const tags = deps.store.listInstanceTags().get(name) ?? []
      deps.log?.info(`Rebuilding instance "${name}" (recreate from definition ${definitionId} to apply current config/credentials).`)
      // Capture the Claude sessions FIRST. cleanupInstance below removes the sandbox
      // irreversibly, so a capture that failed afterwards would have nothing left to read —
      // captureSessions throws on a genuine failure and that abort is the safety property.
      const restoreFrom = await captureRebuildSessions(deps, name, definitionId)
      await cleanupInstance(deps, name)
      return launchDefinition(launchDeps(), definitionId, undefined, undefined, opener ?? 'terminal', tags, restoreFrom)
    }),
    'instance:applyCredentials': (name) => wrap(async () => {
      // Live-apply service/custom credential changes to a running sandbox (no recreate):
      // register values + inject placeholder env vars into /etc/sandbox-persistent.sh.
      const { definitionId, spec } = await resolveInstanceDefinition(deps, name)
      if (!definitionId || !spec) throw new SbxError('not-found', `Instance "${name}" has no linked definition to apply credentials from.`)
      const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
      deps.log?.info(`Applying credentials live to "${name}" from definition ${definitionId}.`)
      return applyCredentialsLive(
        { adapter: deps.adapter, store: deps.store, creds: requireCreds(deps), log: deps.log },
        { name, definitionId, spec, storedFingerprint: meta?.credFingerprint ?? null }
      )
    }),
    'instance:shell': (name) => wrap(async () => {
      const cmd = hostShellCommand(name, capturePortFor(deps, name))
      deps.log?.info(`Opening host shell: ${cmd}`)
      deps.openTerminal(cmd)
      return null
    }),
    // The exact sbx commands to run the agent / open a shell manually (for copy-to-clipboard).
    'instance:commands': (name) => wrap(async () => ({ agent: agentAttachCommand(name, await resolveAgentForInstance(deps, name), capturePortFor(deps, name)), shell: hostShellCommand(name, capturePortFor(deps, name)) })),
    'instance:stop': (name) => wrap(async () => { await deps.adapter.stopSandbox(name); return null }),
    'instance:remove': (name) => wrap(async () => { await cleanupInstance(deps, name); return null }),
    'secret:listGlobal': () => wrap(async () => requireCreds(deps).listGlobalSecrets()),
    'secret:setGlobal': (serviceId, value) => wrap(async () => requireCreds(deps).setGlobalService(serviceId, value)),
    // Set a global secret from the REAL host-env value, read here in the main process so the
    // secret is never sent to the renderer (mirrors cred:stageFromEnv).
    'secret:setGlobalFromEnv': (serviceId) => wrap(async () => {
      const svc = serviceById(serviceId)
      const env: Record<string, string | undefined> = deps.readLoginEnv ? deps.readLoginEnv() : {}
      const envVar = svc?.envVars.find((v) => (env[v] ?? '').trim().length > 0)
      if (!svc || !envVar) throw new Error(`No value for "${serviceId}" found in your environment`)
      return requireCreds(deps).setGlobalService(serviceId, env[envVar]!.trim())
    }),
    'secret:removeGlobal': (id) => wrap(async () => { await requireCreds(deps).removeGlobalSecret(id); return null }),
    'cred:scanEnv': () => wrap(async () => scanEnv((deps.readLoginEnv ?? (() => ({})))())),
    'cred:stageValue': (key, value) => wrap(async () => { requireCreds(deps).stageValue(key, value); return null }),
    // Stash the REAL value of an imported service credential — read from the host env
    // here in the main process, so the secret is never sent to the renderer.
    'cred:stageFromEnv': (key, serviceId) => wrap(async () => {
      const svc = serviceById(serviceId)
      const env: Record<string, string | undefined> = deps.readLoginEnv ? deps.readLoginEnv() : {}
      const envVar = svc?.envVars.find((v) => (env[v] ?? '').trim().length > 0)
      if (!svc || !envVar) throw new Error(`No value for "${serviceId}" found in your environment`)
      requireCreds(deps).stageValue(key, env[envVar]!.trim())
      return null
    }),
    // Live sandbox edits, dual-written to the definition (persist is best-effort + logged).
    'instance:ports:list': (name) => wrap(async () => deps.adapter.listPorts(name)),
    'instance:ports:publish': (name, port) => wrap(async () => {
      const spec = port.hostPort !== null ? `${port.hostPort}:${port.containerPort}/${port.protocol}` : `${port.containerPort}/${port.protocol}`
      deps.log?.info(`Publishing port for "${name}": sbx ports ${name} --publish ${spec}`)
      await deps.adapter.publishPort(name, port)
      const saved = persist(deps, () => applyPortEdit(deps.store, name, port, 'add'), name)
      deps.log?.info(`Port ${spec} forwarded on "${name}"${saved ? ' and saved to its definition' : ''}.`)
      return null
    }),
    'instance:ports:unpublish': (name, port) => wrap(async () => {
      const spec = port.hostPort !== null ? `${port.hostPort}:${port.containerPort}/${port.protocol}` : `${port.containerPort}/${port.protocol}`
      deps.log?.info(`Unpublishing port for "${name}": sbx ports ${name} --unpublish ${spec}`)
      await deps.adapter.unpublishPort(name, port)
      const saved = persist(deps, () => applyPortEdit(deps.store, name, port, 'remove'), name)
      deps.log?.info(`Port ${spec} removed from "${name}"${saved ? ' and its definition' : ''}.`)
      return null
    }),
    'instance:hostService:add': (name, hostPort, label) => wrap(async () => {
      deps.log?.info(`Allowing host service for "${name}": sbx policy allow network --sandbox ${name} localhost:${hostPort}`)
      await deps.adapter.allowNetwork(name, `localhost:${hostPort}`)
      const saved = persist(deps, () => applyHostServiceEdit(deps.store, name, { hostPort, label }, 'add'), name)
      deps.log?.info(`Host service localhost:${hostPort} allowed on "${name}"${saved ? ' and saved to its definition' : ''}.`)
      return null
    }),
    'instance:hostService:remove': (name, hostPort) => wrap(async () => {
      deps.log?.info(`Removing host service for "${name}": sbx policy rm network --sandbox ${name} --resource localhost:${hostPort}`)
      await deps.adapter.removeNetwork(name, `localhost:${hostPort}`)
      const saved = persist(deps, () => applyHostServiceEdit(deps.store, name, { hostPort, label: '' }, 'remove'), name)
      deps.log?.info(`Host service localhost:${hostPort} removed from "${name}"${saved ? ' and its definition' : ''}.`)
      return null
    }),
    'instance:domain:allow': (name, domain) => wrap(async () => {
      deps.log?.info(`Allowing domain for "${name}": sbx policy allow network --sandbox ${name} ${domain}`)
      await deps.adapter.allowNetwork(name, domain)
      const saved = persist(deps, () => applyDomainEdit(deps.store, name, domain, 'add'), name)
      deps.log?.info(`Domain ${domain} allowed on "${name}"${saved ? ' and saved to its definition' : ''}. (The old blocked entry may linger in the traffic log until the next request.)`)
      return null
    }),
    'instance:domain:deny': (name, domain) => wrap(async () => {
      deps.log?.info(`Denying domain for "${name}": sbx policy rm network --sandbox ${name} --resource ${domain}`)
      await deps.adapter.removeNetwork(name, domain)
      const saved = persist(deps, () => applyDomainEdit(deps.store, name, domain, 'remove'), name)
      deps.log?.info(`Domain ${domain} denied on "${name}"${saved ? ' and removed from its definition' : ''}.`)
      return null
    }),
    'instance:policyLog': (name) => wrap(async () => deps.adapter.policyLog(name)),
    'instance:stats': (name) => wrap(() => fetchResourceStats(deps.adapter, name)),
    'instance:fs:listDir': (name, path) => wrap(() => deps.adapter.listSandboxDir(name, expandSandboxPath(path))),
    'instance:fs:plan': (name, direction, sources, dest, defaults) => wrap(async () => {
      const resolvedSources = sources.map((s) =>
        direction === 'toSandbox' ? resolveHostPath(defaults.host, s) : resolveSandboxPathM(defaults.sandbox, s))
      const resolvedDest = direction === 'toSandbox'
        ? resolveSandboxPathM(defaults.sandbox, dest)
        : resolveHostPath(defaults.host, dest)
      const destIsDir = direction === 'toSandbox'
        ? (await deps.adapter.probeSandboxPath(name, resolvedDest)) === 'dir'
        : nodeFs.existsSync(resolvedDest) && nodeFs.statSync(resolvedDest).isDirectory()
      const targets = resolvedSources.map((rs) => {
        if (!destIsDir) return resolvedDest
        const base = basenameAny(rs)
        return direction === 'toSandbox' ? posixJoin(resolvedDest, base) : join(resolvedDest, base)
      })
      const existing = direction === 'toSandbox'
        ? await deps.adapter.sandboxTargetsExist(name, targets)
        : targets.map((t) => nodeFs.existsSync(t))
      const items = resolvedSources.map((rs, i) => ({
        source: sources[i], resolvedSource: rs, target: targets[i], willOverwrite: existing[i]
      }))
      return { resolvedDest, items }
    }),
    'instance:fs:copy': (name, direction, sources, dest) => wrap(async () => {
      const results: CopyResult[] = []
      for (const src of sources) {
        try {
          if (direction === 'toSandbox') await deps.adapter.copyToSandbox(name, src, dest)
          else await deps.adapter.copyFromSandbox(name, src, dest)
          results.push({ source: src, ok: true })
        } catch (e) {
          results.push({ source: src, ok: false, error: (e as Error).message })
        }
      }
      return results
    }),
    'auth:status': () => wrap(() => claudeAuthStatus(deps.adapter)),
    'auth:signOut': () => wrap(async () => { await claudeSignOut(deps.adapter); return null }),
    'auth:startLogin': () => wrap(async () => {
      if (!deps.loginKitDir) throw new Error('login kit not configured')
      const name = 'sbx-oauth-login'
      const kitDir = deps.loginKitDir()
      const workdir = kitDir.replace(/\/[^/]+$/, '') // the login temp dir (kit lives under it)
      const cmd = loginCommand(workdir, name, kitDir)
      deps.log?.info(`Opening Claude OAuth login terminal: ${cmd}`)
      deps.openTerminal(cmd)
      return { name }
    }),
    // `platform` rides along so the renderer's host-setup guide can open on the OS the
    // user is actually running — the setup steps are entirely different per platform.
    // Detection itself is platform-aware: on Windows the login env can never carry
    // SSH_AUTH_SOCK, so sshAgentPresent probes the agent instead of reading the env.
    'ssh:detect': () => wrap(async () => {
      const platform = deps.platform ?? process.platform
      const present = sshAgentPresent({ platform, env: deps.readLoginEnv?.() ?? {}, runSshAdd: deps.sshProbe })
      return { present, platform }
    }),
    'host:capacity': () => wrap(async () => readHostCapacity()),
    'env:hasVSCode': () => wrap(async () => ({ present: codeCliPresent() })),
    'kit:validate': (yaml) => wrap(async () => {
      const norm = normalizeCommandsYaml(yaml)
      if (!norm.ok) return { status: 'invalid', message: norm.error } as KitValidation
      // Build a minimal kit spec.yaml carrying just these commands and validate it.
      const specYaml = `schemaVersion: "1"\nkind: mixin\nname: kit-validate\n${norm.yaml}`
      const dir = nodeFs.mkdtempSync(join(os.tmpdir(), 'sbx-kit-'))
      try {
        nodeFs.writeFileSync(join(dir, 'spec.yaml'), specYaml, { mode: 0o644 })
        const r = await deps.adapter.validateKit(dir)
        if (!r.ran) return { status: 'unavailable', message: 'Validation unavailable (sbx not found).' } as KitValidation
        return { status: r.code === 0 ? 'valid' : 'invalid', message: r.out || (r.code === 0 ? 'Valid kit.' : `sbx kit validate exited ${r.code}`) } as KitValidation
      } finally {
        try { nodeFs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
      }
    }),
    'prefs:get': (key) => wrap(async () => deps.store.getPref(key)),
    'prefs:set': (key, value) => wrap(async () => { deps.store.setPref(key, value); return null }),
    'capture:status': () => wrap(async () => deps.capture?.status() ?? { sandbox: null, state: 'off' as const, checks: [] }),
    'capture:enable': (name, force) => wrap(async () => requireCapture(deps).enable(name, { force })),
    'capture:disable': () => wrap(async () => requireCapture(deps).disable()),
    'capture:settingsGet': () => wrap(async () => readBurpSettings(deps.store)),
    'capture:settingsSet': (patch) => wrap(async () => writeBurpSettings(deps.store, patch)),
    'capture:caInspect': (path) => wrap(async () => (deps.readCa ?? readCaFile)(path)),
    'capture:burpConfig': () => wrap(async () => buildBurpUserConfig(readBurpSettings(deps.store).upstreamPort)),
    // Writing to disk is a main-process job — reuse the same Save dialog def:export uses.
    'capture:exportConfig': () => wrap(async () => {
      if (!deps.saveFile) throw new Error('file export is not available in this session')
      const contents = buildBurpUserConfig(readBurpSettings(deps.store).upstreamPort)
      const path = await deps.saveFile(BURP_CONFIG_FILENAME, contents)
      return path === null ? { canceled: true } : { path }
    }),
    'creds:storageStatus': () => wrap(async () => deps.storageStatus
      ? deps.storageStatus()
      : { platform: process.platform, backend: 'unknown', secure: false }),
    'mcp:supported': () => wrap(() => deps.adapter.mcpSupported()),
    'mcp:list': () => wrap(async () => {
      if (mcpListCache && now() - mcpListCache.at < MCP_LIST_CACHE_MS) return mcpListCache.data
      const data = await deps.adapter.listMcpServers()
      mcpListCache = { at: now(), data }
      return data
    }),
    'mcp:inspect': (name) => wrap(() => deps.adapter.inspectMcpServer(name)),
    'mcp:add': (input) => wrap(async () => {
      await deps.adapter.addMcpServer(input)
      mcpListCache = null
      deps.log?.info(`Registered MCP server "${input.name}".`)
      return null
    }),
    'mcp:remove': (name) => wrap(async () => {
      await deps.adapter.removeMcpServer(name)
      mcpListCache = null
      deps.log?.info(`Removed MCP server "${name}".`)
      return null
    }),
    'mcp:authStatus': (name) => wrap(() => deps.adapter.mcpAuthStatus(name)),
    // `sbx mcp auth <server>` blocks on a browser OAuth flow, so — like auth:startLogin —
    // it runs in a native terminal rather than a captured child process, and this returns
    // as soon as the terminal is opened.
    'mcp:startAuth': (name) => wrap(async () => {
      const cmd = mcpAuthCommand(name)
      deps.log?.info(`Opening MCP auth terminal for "${name}": ${cmd}`)
      deps.openTerminal(cmd)
      return null
    }),
    // The secret value is consumed here (forwarded to the adapter's stdin secret path) and
    // never included in the Result — nothing but a success/failure signal crosses back.
    'mcp:setClientSecret': (name, value) => wrap(async () => { await deps.adapter.setMcpClientSecret(name, value); return null }),
    'mcp:removeAuth': (name) => wrap(async () => { await deps.adapter.removeMcpAuth(name); return null })
  }
}

/** Run a definition-persist edit; the live sbx op already succeeded, so failures are logged, not thrown. Returns whether the definition was updated. */
function persist(deps: Deps, edit: () => boolean, name: string): boolean {
  try {
    const saved = edit()
    if (!saved) deps.log?.info(`"${name}" isn't linked to a definition — applied live only, not persisted.`)
    return saved
  } catch (e) {
    deps.log?.error(`Could not persist edit to "${name}"'s definition: ${(e as Error).message}`)
    return false
  }
}

/**
 * Remove one instance and its side artifacts: the sbx sandbox, its sandbox-scoped secrets
 * (not auto-removed by sbx), the generated <workspace>/.sandbox dir, and its metadata row.
 * Shared by `instance:remove` and `def:remove`.
 */
/**
 * Archive an instance's Claude sessions ahead of a rebuild, returning what to restore into
 * its replacement (or undefined when there is nothing to carry over).
 *
 * Deliberately does NOT swallow errors: the caller destroys the sandbox next, so a failed
 * capture must abort the rebuild rather than silently cost the user their conversations.
 */
async function captureRebuildSessions(deps: Deps, name: string, definitionId: string): Promise<SessionRestore | undefined> {
  if (!deps.sessionArchiveBaseDir) return undefined
  const dir = await captureSessions({ adapter: deps.adapter }, { sbxName: name, definitionId, baseDir: deps.sessionArchiveBaseDir })
  if (!dir) {
    deps.log?.info(`No Claude sessions to preserve from "${name}".`)
    return undefined
  }
  const subdirs = archivedSubdirs(dir)
  deps.log?.info(`Preserved ${subdirs.join(', ')} from "${name}" to ${dir}.`)
  return { dir, subdirs }
}

async function cleanupInstance(deps: Deps, name: string): Promise<void> {
  // Read meta/spec BEFORE removing the sandbox. The renderer polls instances:list every 4 s,
  // which triggers reconcile() and GC's the metadata row the moment the sandbox disappears
  // from `sbx ls`. Reading after removeSandbox risks finding meta already deleted.
  const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
  const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
  await deps.adapter.removeSandbox(name)
  for (const c of spec?.credentials ?? []) {
    try {
      if (c.kind === 'service') await deps.adapter.removeSecret(c.serviceId, { sandbox: name })
      else if (c.kind === 'custom') await deps.adapter.removeCustomSecret(c.domains, { sandbox: name })
      else if (c.scope === 'sandbox') await deps.adapter.removeRegistrySecret(c.host, { sandbox: name })
    } catch (e) {
      deps.log?.error(`Could not remove scoped secret for "${name}": ${(e as Error).message}`)
    }
  }
  const workspaceDir = (spec?.mounts.find((m) => m.isPrimary) ?? spec?.mounts[0])?.hostPath?.trim()
  if (workspaceDir && deps.cleanupKit) {
    try { deps.cleanupKit(workspaceDir); deps.log?.info(`Removed ${workspaceDir}/.sandbox for "${name}".`) }
    catch (e) { deps.log?.error(`Could not remove .sandbox for "${name}": ${(e as Error).message}`) }
  }
  deps.store.deleteInstanceMeta(name)
}

export function registerIpc(deps: Deps): void {
  const handlers = buildHandlers(deps)
  ipcMain.handle('prereq:check', () => handlers['prereq:check']())
  ipcMain.handle('instances:list', () => handlers['instances:list']())
  ipcMain.handle('def:create', (_e, spec: DefinitionSpec) => handlers['def:create'](spec))
  ipcMain.handle('def:update', (_e, spec: DefinitionSpec) => handlers['def:update'](spec))
  ipcMain.handle('def:getSpec', (_e, id: string) => handlers['def:getSpec'](id))
  ipcMain.handle('def:list', () => handlers['def:list']())
  ipcMain.handle('def:export', (_e, ids: string[]) => handlers['def:export'](ids))
  ipcMain.handle('def:import', () => handlers['def:import']())
  ipcMain.handle('def:remove', (_e, id: string) => handlers['def:remove'](id))
  ipcMain.handle('instance:launch', (_e, id: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[]) => handlers['instance:launch'](id, name, sessionName, opener, tags))
  ipcMain.handle('instance:setTags', (_e, name: string, tags: string[]) => handlers['instance:setTags'](name, tags))
  ipcMain.handle('instance:attach', (_e, name: string, opener?: 'terminal' | 'vscode') => handlers['instance:attach'](name, opener))
  ipcMain.handle('instance:rebuild', (_e, name: string, opener?: 'terminal' | 'vscode') => handlers['instance:rebuild'](name, opener))
  ipcMain.handle('instance:applyCredentials', (_e, name: string) => handlers['instance:applyCredentials'](name))
  ipcMain.handle('instance:commands', (_e, name: string) => handlers['instance:commands'](name))
  ipcMain.handle('instance:shell', (_e, name: string) => handlers['instance:shell'](name))
  ipcMain.handle('instance:stop', (_e, name: string) => handlers['instance:stop'](name))
  ipcMain.handle('instance:remove', (_e, name: string) => handlers['instance:remove'](name))
  ipcMain.handle('secret:listGlobal', () => handlers['secret:listGlobal']())
  ipcMain.handle('secret:setGlobal', (_e, serviceId: string, value: string) => handlers['secret:setGlobal'](serviceId, value))
  ipcMain.handle('secret:setGlobalFromEnv', (_e, serviceId: string) => handlers['secret:setGlobalFromEnv'](serviceId))
  ipcMain.handle('secret:removeGlobal', (_e, id: string) => handlers['secret:removeGlobal'](id))
  ipcMain.handle('cred:scanEnv', () => handlers['cred:scanEnv']())
  ipcMain.handle('cred:stageValue', (_e, key: string, value: string) => handlers['cred:stageValue'](key, value))
  ipcMain.handle('cred:stageFromEnv', (_e, key: string, serviceId: string) => handlers['cred:stageFromEnv'](key, serviceId))
  ipcMain.handle('instance:ports:list', (_e, name: string) => handlers['instance:ports:list'](name))
  ipcMain.handle('instance:ports:publish', (_e, name: string, port: LivePort) => handlers['instance:ports:publish'](name, port))
  ipcMain.handle('instance:ports:unpublish', (_e, name: string, port: LivePort) => handlers['instance:ports:unpublish'](name, port))
  ipcMain.handle('instance:hostService:add', (_e, name: string, hostPort: number, label: string) => handlers['instance:hostService:add'](name, hostPort, label))
  ipcMain.handle('instance:hostService:remove', (_e, name: string, hostPort: number) => handlers['instance:hostService:remove'](name, hostPort))
  ipcMain.handle('instance:domain:allow', (_e, name: string, domain: string) => handlers['instance:domain:allow'](name, domain))
  ipcMain.handle('instance:domain:deny', (_e, name: string, domain: string) => handlers['instance:domain:deny'](name, domain))
  ipcMain.handle('instance:policyLog', (_e, name: string) => handlers['instance:policyLog'](name))
  ipcMain.handle('instance:stats', (_e, name: string) => handlers['instance:stats'](name))
  ipcMain.handle('instance:fs:listDir', (_e, name: string, path: string) => handlers['instance:fs:listDir'](name, path))
  ipcMain.handle('instance:fs:plan', (_e, name: string, direction: CopyDirection, sources: string[], dest: string, defaults: { host: string; sandbox: string }) => handlers['instance:fs:plan'](name, direction, sources, dest, defaults))
  ipcMain.handle('instance:fs:copy', (_e, name: string, direction: CopyDirection, sources: string[], dest: string) => handlers['instance:fs:copy'](name, direction, sources, dest))
  ipcMain.handle('auth:status', () => handlers['auth:status']())
  ipcMain.handle('auth:signOut', () => handlers['auth:signOut']())
  ipcMain.handle('auth:startLogin', () => handlers['auth:startLogin']())
  ipcMain.handle('ssh:detect', () => handlers['ssh:detect']())
  ipcMain.handle('host:capacity', () => handlers['host:capacity']())
  ipcMain.handle('env:hasVSCode', () => handlers['env:hasVSCode']())
  ipcMain.handle('kit:validate', (_e, yaml: string) => handlers['kit:validate'](yaml))
  ipcMain.handle('prefs:get', (_e, key: string) => handlers['prefs:get'](key))
  ipcMain.handle('prefs:set', (_e, key: string, value: string) => handlers['prefs:set'](key, value))
  ipcMain.handle('capture:status', () => handlers['capture:status']())
  ipcMain.handle('capture:enable', (_e, name: string, force: boolean) => handlers['capture:enable'](name, force))
  ipcMain.handle('capture:disable', () => handlers['capture:disable']())
  ipcMain.handle('capture:settingsGet', () => handlers['capture:settingsGet']())
  ipcMain.handle('capture:settingsSet', (_e, patch: Partial<BurpSettings>) => handlers['capture:settingsSet'](patch))
  ipcMain.handle('capture:caInspect', (_e, path: string) => handlers['capture:caInspect'](path))
  ipcMain.handle('capture:burpConfig', () => handlers['capture:burpConfig']())
  ipcMain.handle('capture:exportConfig', () => handlers['capture:exportConfig']())
  ipcMain.handle('creds:storageStatus', () => handlers['creds:storageStatus']())
  ipcMain.handle('mcp:supported', () => handlers['mcp:supported']())
  ipcMain.handle('mcp:list', () => handlers['mcp:list']())
  ipcMain.handle('mcp:inspect', (_e, name: string) => handlers['mcp:inspect'](name))
  ipcMain.handle('mcp:add', (_e, input: McpAddInput) => handlers['mcp:add'](input))
  ipcMain.handle('mcp:remove', (_e, name: string) => handlers['mcp:remove'](name))
  ipcMain.handle('mcp:authStatus', (_e, name: string) => handlers['mcp:authStatus'](name))
  ipcMain.handle('mcp:startAuth', (_e, name: string) => handlers['mcp:startAuth'](name))
  ipcMain.handle('mcp:setClientSecret', (_e, name: string, value: string) => handlers['mcp:setClientSecret'](name, value))
  ipcMain.handle('mcp:removeAuth', (_e, name: string) => handlers['mcp:removeAuth'](name))
  ipcMain.handle('dialog:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  ipcMain.handle('dialog:pickFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openFile' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  ipcMain.handle('dialog:pickPaths', async (e, mode: 'files' | 'folder') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const properties = mode === 'folder'
      ? (['openDirectory', 'multiSelections'] as const)
      : (['openFile', 'multiSelections'] as const)
    const opts = { properties: [...properties] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths
  })
}
