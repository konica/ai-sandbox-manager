import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition, GlobalSecretMeta, EnvHit } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { checkPrereqs, type Probes } from './prereq'
import { reconcile } from './reconciler'
import { launchDefinition } from './launch'
import { agentAttachCommand, hostShellCommand } from './sbx/translate'
import { scanEnv } from './creds/env-scan'
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
  'instance:launch': (definitionId: string, name?: string, sessionName?: string) => Promise<Result<{ name: string }>>
  'instance:attach': (name: string) => Promise<Result<null>>
  'instance:shell': (name: string) => Promise<Result<null>>
  'instance:stop': (name: string) => Promise<Result<null>>
  'instance:remove': (name: string) => Promise<Result<null>>
  'secret:listGlobal': () => Promise<Result<GlobalSecretMeta[]>>
  'secret:setGlobal': (serviceId: string, value: string) => Promise<Result<GlobalSecretMeta>>
  'secret:removeGlobal': (id: string) => Promise<Result<null>>
  'cred:scanEnv': () => Promise<Result<EnvHit[]>>
  'cred:stageValue': (key: string, value: string) => Promise<Result<null>>
  'cred:stageFromEnv': (key: string, serviceId: string) => Promise<Result<null>>
} {
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(() => reconcile(deps.adapter, deps.store)),
    'def:create': (spec) => wrap(async () => { deps.store.insertDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:update': (spec) => wrap(async () => { deps.store.updateDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:getSpec': (id) => wrap(async () => deps.store.getDefinitionSpec(id)),
    'def:list': () => wrap(async () => deps.store.listDefinitions()),
    'instance:launch': (definitionId, name, sessionName) => wrap(() => launchDefinition(
      {
        adapter: deps.adapter,
        store: deps.store,
        creds: deps.creds ?? { getStaged: () => null },
        materializeKit: deps.materializeKit ?? (() => undefined),
        openTerminal: deps.openTerminal,
        log: deps.log
      },
      definitionId, name, sessionName
    )),
    'instance:attach': (name) => wrap(async () => {
      const cmd = agentAttachCommand(name)
      deps.log?.info(`Opening agent terminal: ${cmd}`)
      deps.openTerminal(cmd)
      return null
    }),
    'instance:shell': (name) => wrap(async () => {
      const cmd = hostShellCommand(name)
      deps.log?.info(`Opening host shell: ${cmd}`)
      deps.openTerminal(cmd)
      return null
    }),
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
          else await deps.adapter.removeCustomSecret(c.domains, { sandbox: name })
        } catch (e) {
          deps.log?.error(`Could not remove scoped secret for "${name}": ${(e as Error).message}`)
        }
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
    })
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
  ipcMain.handle('instance:launch', (_e, id: string, name?: string, sessionName?: string) => handlers['instance:launch'](id, name, sessionName))
  ipcMain.handle('instance:attach', (_e, name: string) => handlers['instance:attach'](name))
  ipcMain.handle('instance:shell', (_e, name: string) => handlers['instance:shell'](name))
  ipcMain.handle('instance:stop', (_e, name: string) => handlers['instance:stop'](name))
  ipcMain.handle('instance:remove', (_e, name: string) => handlers['instance:remove'](name))
  ipcMain.handle('secret:listGlobal', () => handlers['secret:listGlobal']())
  ipcMain.handle('secret:setGlobal', (_e, serviceId: string, value: string) => handlers['secret:setGlobal'](serviceId, value))
  ipcMain.handle('secret:removeGlobal', (_e, id: string) => handlers['secret:removeGlobal'](id))
  ipcMain.handle('cred:scanEnv', () => handlers['cred:scanEnv']())
  ipcMain.handle('cred:stageValue', (_e, key: string, value: string) => handlers['cred:stageValue'](key, value))
  ipcMain.handle('cred:stageFromEnv', (_e, key: string, serviceId: string) => handlers['cred:stageFromEnv'](key, serviceId))
  ipcMain.handle('dialog:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
}
