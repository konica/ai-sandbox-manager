import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition, GlobalSecretMeta, EnvHit, LivePort, PolicySummary, AuthStatus, ClaudeAuthKind } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { checkPrereqs, type Probes } from './prereq'
import { reconcile } from './reconciler'
import { launchDefinition } from './launch'
import { agentAttachCommand, hostShellCommand, loginCommand } from './sbx/translate'
import { claudeAuthStatus, claudeSignOut, needsAuthNudge } from './auth/manager'
import { sshAuthSockPresent } from './ssh/detect'
import { codeCliPresent } from './vscode'
import { scanEnv } from './creds/env-scan'
import { applyPortEdit, applyHostServiceEdit, applyDomainEdit } from './detail/persist'
import { serviceById } from '@shared/services'
import type { CredentialManager } from './creds/manager'
import type { Logger } from './log'

interface Deps {
  adapter: SbxAdapter
  store: Store
  probes: Probes
  openTerminal: (command: string) => void
  creds?: CredentialManager
  materializeKit?: (spec: DefinitionSpec, name: string) => string | undefined
  readLoginEnv?: () => Record<string, string | undefined>
  loginKitDir?: () => string // materializes the OAuth login kit, returns its dir
  openVSCode?: (command: string, workspaceDir: string, sandboxName: string) => void
  genHash?: () => string
  /** Removes the generated <workspace>/.sandbox dir on instance removal (re-created at next launch). */
  cleanupKit?: (workspaceDir: string) => void
  log?: Logger
}

function requireCreds(deps: Deps): CredentialManager {
  if (!deps.creds) throw new Error('credential manager not configured')
  return deps.creds
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
  'instance:launch': (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode') => Promise<Result<{ name: string }>>
  'instance:attach': (name: string, opener?: 'terminal' | 'vscode') => Promise<Result<null>>
  'instance:commands': (name: string) => Promise<Result<{ agent: string; shell: string }>>
  'instance:shell': (name: string) => Promise<Result<null>>
  'instance:stop': (name: string) => Promise<Result<null>>
  'instance:remove': (name: string) => Promise<Result<null>>
  'secret:listGlobal': () => Promise<Result<GlobalSecretMeta[]>>
  'secret:setGlobal': (serviceId: string, value: string) => Promise<Result<GlobalSecretMeta>>
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
  'auth:launchPrecheck': (definitionId: string) => Promise<Result<{ needsNudge: boolean; status: ClaudeAuthKind }>>
  'ssh:detect': () => Promise<Result<{ present: boolean }>>
  'env:hasVSCode': () => Promise<Result<{ present: boolean }>>
} {
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(() => reconcile(deps.adapter, deps.store)),
    'def:create': (spec) => wrap(async () => { deps.store.insertDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:update': (spec) => wrap(async () => { deps.store.updateDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:getSpec': (id) => wrap(async () => deps.store.getDefinitionSpec(id)),
    'def:list': () => wrap(async () => deps.store.listDefinitions()),
    'instance:launch': (definitionId, name, sessionName, opener) => wrap(() => launchDefinition(
      {
        adapter: deps.adapter,
        store: deps.store,
        creds: deps.creds ?? { getStaged: () => null },
        materializeKit: deps.materializeKit ?? (() => undefined),
        openTerminal: deps.openTerminal,
        openVSCode: deps.openVSCode,
        genHash: deps.genHash,
        log: deps.log
      },
      definitionId, name, sessionName, opener ?? 'terminal'
    )),
    'instance:attach': (name, opener) => wrap(async () => {
      const cmd = agentAttachCommand(name)
      const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
      const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
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
    'instance:shell': (name) => wrap(async () => {
      const cmd = hostShellCommand(name)
      deps.log?.info(`Opening host shell: ${cmd}`)
      deps.openTerminal(cmd)
      return null
    }),
    // The exact sbx commands to run the agent / open a shell manually (for copy-to-clipboard).
    'instance:commands': (name) => wrap(async () => ({ agent: agentAttachCommand(name), shell: hostShellCommand(name) })),
    'instance:stop': (name) => wrap(async () => { await deps.adapter.stopSandbox(name); return null }),
    'instance:remove': (name) => wrap(async () => {
      await deps.adapter.removeSandbox(name)
      // Sandbox-scoped secrets are NOT auto-removed with the sandbox (Phase 0 spike) —
      // clean up this instance's scoped secrets so they don't accumulate. Best-effort.
      const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
      const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
      for (const c of spec?.credentials ?? []) {
        try {
          if (c.kind === 'service') await deps.adapter.removeSecret(c.serviceId, { sandbox: name })
          else if (c.kind === 'custom') await deps.adapter.removeCustomSecret(c.domains, { sandbox: name })
          // Only sandbox-scoped registry creds are scoped to this VM; host/global are shared, leave them.
          else if (c.scope === 'sandbox') await deps.adapter.removeRegistrySecret(c.host, { sandbox: name })
        } catch (e) {
          deps.log?.error(`Could not remove scoped secret for "${name}": ${(e as Error).message}`)
        }
      }
      // Remove the generated .sandbox kit dir from the workspace (re-created at next launch).
      const workspaceDir = (spec?.mounts.find((m) => m.isPrimary) ?? spec?.mounts[0])?.hostPath?.trim()
      if (workspaceDir && deps.cleanupKit) {
        try { deps.cleanupKit(workspaceDir); deps.log?.info(`Removed ${workspaceDir}/.sandbox for "${name}".`) }
        catch (e) { deps.log?.error(`Could not remove .sandbox for "${name}": ${(e as Error).message}`) }
      }
      deps.store.deleteInstanceMeta(name)
      return null
    }),
    'secret:listGlobal': () => wrap(async () => requireCreds(deps).listGlobalSecrets()),
    'secret:setGlobal': (serviceId, value) => wrap(async () => requireCreds(deps).setGlobalService(serviceId, value)),
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
    'auth:launchPrecheck': (definitionId) => wrap(async () => {
      const spec = deps.store.getDefinitionSpec(definitionId)
      const { anthropic } = await claudeAuthStatus(deps.adapter)
      const needsNudge = spec ? needsAuthNudge(anthropic, spec) : false
      return { needsNudge, status: anthropic }
    }),
    'ssh:detect': () => wrap(async () => ({ present: sshAuthSockPresent(deps.readLoginEnv?.() ?? {}) })),
    'env:hasVSCode': () => wrap(async () => ({ present: codeCliPresent() }))
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

export function registerIpc(deps: Deps): void {
  const handlers = buildHandlers(deps)
  ipcMain.handle('prereq:check', () => handlers['prereq:check']())
  ipcMain.handle('instances:list', () => handlers['instances:list']())
  ipcMain.handle('def:create', (_e, spec: DefinitionSpec) => handlers['def:create'](spec))
  ipcMain.handle('def:update', (_e, spec: DefinitionSpec) => handlers['def:update'](spec))
  ipcMain.handle('def:getSpec', (_e, id: string) => handlers['def:getSpec'](id))
  ipcMain.handle('def:list', () => handlers['def:list']())
  ipcMain.handle('instance:launch', (_e, id: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode') => handlers['instance:launch'](id, name, sessionName, opener))
  ipcMain.handle('instance:attach', (_e, name: string, opener?: 'terminal' | 'vscode') => handlers['instance:attach'](name, opener))
  ipcMain.handle('instance:commands', (_e, name: string) => handlers['instance:commands'](name))
  ipcMain.handle('instance:shell', (_e, name: string) => handlers['instance:shell'](name))
  ipcMain.handle('instance:stop', (_e, name: string) => handlers['instance:stop'](name))
  ipcMain.handle('instance:remove', (_e, name: string) => handlers['instance:remove'](name))
  ipcMain.handle('secret:listGlobal', () => handlers['secret:listGlobal']())
  ipcMain.handle('secret:setGlobal', (_e, serviceId: string, value: string) => handlers['secret:setGlobal'](serviceId, value))
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
  ipcMain.handle('auth:launchPrecheck', (_e, id: string) => handlers['auth:launchPrecheck'](id))
  ipcMain.handle('ssh:detect', () => handlers['ssh:detect']())
  ipcMain.handle('env:hasVSCode', () => handlers['env:hasVSCode']())
  ipcMain.handle('dialog:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
}
