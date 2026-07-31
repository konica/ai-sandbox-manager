import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition, GlobalSecretMeta, EnvHit, LivePort, PolicySummary, AuthStatus, KitValidation, StorageStatus } from '@shared/types'
import type { AgentId } from '@shared/agents'
import { AGENT_PROFILES } from '@shared/agents'
import { needsProviderDomainWarning } from '@shared/provider-domain'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { checkPrereqs, type Probes } from './prereq'
import { reconcile } from './reconciler'
import { launchDefinition } from './launch'
import { SbxError } from '@shared/errors'
import { registerCredentials } from './creds/register'
import { agentAttachCommand, hostShellCommand, loginCommand } from './sbx/translate'
import { claudeAuthStatus, claudeSignOut } from './auth/manager'
import { sshAgentPresent } from './ssh/detect'
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
import { join } from 'node:path'

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
}

function requireCreds(deps: Deps): CredentialManager {
  if (!deps.creds) throw new Error('credential manager not configured')
  return deps.creds
}

/** The agent to resume/attach with: the linked definition's own agent, or 'claude' when the
 * instance isn't tracked by the app (no definition to consult) — matching the app's
 * pre-multi-agent behavior for anything it doesn't manage. */
function resolveAgentForInstance(deps: { store: Pick<Store, 'listInstanceMeta' | 'getDefinitionSpec'> }, name: string): AgentId {
  const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
  const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
  return spec?.definition.agent ?? 'claude'
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
  'instance:launch': (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode') => Promise<Result<{ name: string }>>
  'instance:attach': (name: string, opener?: 'terminal' | 'vscode') => Promise<Result<null>>
  'instance:rebuild': (name: string, opener?: 'terminal' | 'vscode') => Promise<Result<{ name: string }>>
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
  'auth:status': () => Promise<Result<AuthStatus>>
  'auth:signOut': () => Promise<Result<null>>
  'auth:startLogin': () => Promise<Result<{ name: string }>>
  'ssh:detect': () => Promise<Result<{ present: boolean; platform: string }>>
  'env:hasVSCode': () => Promise<Result<{ present: boolean }>>
  'kit:validate': (yaml: string) => Promise<Result<KitValidation>>
  'prefs:get': (key: string) => Promise<Result<string | null>>
  'prefs:set': (key: string, value: string) => Promise<Result<null>>
  'creds:storageStatus': () => Promise<Result<StorageStatus>>
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
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(() => reconcile(deps.adapter, deps.store)),
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
    'instance:launch': (definitionId, name, sessionName, opener) => wrap(() => launchDefinition(
      launchDeps(),
      definitionId, name, sessionName, opener ?? 'terminal'
    )),
    'instance:attach': (name, opener) => wrap(async () => {
      const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
      const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
      const cmd = agentAttachCommand(name, spec?.definition.agent ?? 'claude')
      // Re-register the definition's current credentials scoped to this instance so any
      // added/changed since the initial launch are synced into sbx before the agent runs.
      if (spec && deps.creds && meta?.definitionId && spec.credentials.length > 0) {
        await registerCredentials({ adapter: deps.adapter, creds: deps.creds, log: deps.log }, meta.definitionId, spec.credentials, name)
      }
      const workspaceDir = (spec?.mounts.find((m) => m.isPrimary) ?? spec?.mounts[0])?.hostPath?.trim()
      if (opener === 'vscode' && deps.openVSCode && workspaceDir) {
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
      const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
      if (!meta?.definitionId) throw new SbxError('not-found', `Instance "${name}" has no linked definition to rebuild from.`)
      deps.log?.info(`Rebuilding instance "${name}" (recreate from definition ${meta.definitionId} to apply current config/credentials).`)
      await cleanupInstance(deps, name)
      return launchDefinition(launchDeps(), meta.definitionId, undefined, undefined, opener ?? 'terminal')
    }),
    'instance:shell': (name) => wrap(async () => {
      const cmd = hostShellCommand(name)
      deps.log?.info(`Opening host shell: ${cmd}`)
      deps.openTerminal(cmd)
      return null
    }),
    // The exact sbx commands to run the agent / open a shell manually (for copy-to-clipboard).
    'instance:commands': (name) => wrap(async () => ({ agent: agentAttachCommand(name, resolveAgentForInstance(deps, name)), shell: hostShellCommand(name) })),
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
    'creds:storageStatus': () => wrap(async () => deps.storageStatus
      ? deps.storageStatus()
      : { platform: process.platform, backend: 'unknown', secure: false })
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
  ipcMain.handle('instance:launch', (_e, id: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode') => handlers['instance:launch'](id, name, sessionName, opener))
  ipcMain.handle('instance:attach', (_e, name: string, opener?: 'terminal' | 'vscode') => handlers['instance:attach'](name, opener))
  ipcMain.handle('instance:rebuild', (_e, name: string, opener?: 'terminal' | 'vscode') => handlers['instance:rebuild'](name, opener))
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
  ipcMain.handle('auth:status', () => handlers['auth:status']())
  ipcMain.handle('auth:signOut', () => handlers['auth:signOut']())
  ipcMain.handle('auth:startLogin', () => handlers['auth:startLogin']())
  ipcMain.handle('ssh:detect', () => handlers['ssh:detect']())
  ipcMain.handle('env:hasVSCode', () => handlers['env:hasVSCode']())
  ipcMain.handle('kit:validate', (_e, yaml: string) => handlers['kit:validate'](yaml))
  ipcMain.handle('prefs:get', (_e, key: string) => handlers['prefs:get'](key))
  ipcMain.handle('prefs:set', (_e, key: string, value: string) => handlers['prefs:set'](key, value))
  ipcMain.handle('creds:storageStatus', () => handlers['creds:storageStatus']())
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
}
