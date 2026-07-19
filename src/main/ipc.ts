import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition, GlobalSecretMeta, EnvHit } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { checkPrereqs, type Probes } from './prereq'
import { reconcile } from './reconciler'
import { launchDefinition } from './launch'
import { agentAttachCommand, hostShellCommand } from './sbx/translate'
import { scanEnv } from './creds/env-scan'
import type { CredentialManager } from './creds/manager'
import type { Logger } from './log'

interface Deps {
  adapter: SbxAdapter
  store: Store
  probes: Probes
  openTerminal: (command: string) => void
  creds?: CredentialManager
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
} {
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(() => reconcile(deps.adapter, deps.store)),
    'def:create': (spec) => wrap(async () => { deps.store.insertDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:update': (spec) => wrap(async () => { deps.store.updateDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:getSpec': (id) => wrap(async () => deps.store.getDefinitionSpec(id)),
    'def:list': () => wrap(async () => deps.store.listDefinitions()),
    'instance:launch': (definitionId, name, sessionName) => wrap(() => launchDefinition(
      { adapter: deps.adapter, store: deps.store, openTerminal: deps.openTerminal, log: deps.log }, definitionId, name, sessionName
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
      deps.store.deleteInstanceMeta(name)
      return null
    }),
    'secret:listGlobal': () => wrap(async () => requireCreds(deps).listGlobalSecrets()),
    'secret:setGlobal': (serviceId, value) => wrap(async () => requireCreds(deps).setGlobalService(serviceId, value)),
    'secret:removeGlobal': (id) => wrap(async () => { await requireCreds(deps).removeGlobalSecret(id); return null }),
    'cred:scanEnv': () => wrap(async () => scanEnv((deps.readLoginEnv ?? (() => ({})))())),
    'cred:stageValue': (key, value) => wrap(async () => {
      const [kind, id] = key.split(':', 2)
      const creds = requireCreds(deps)
      if (kind === 'service') creds.stageServiceValue(id, value)
      else if (kind === 'custom') creds.stageCustomValue(id, value)
      else throw new Error(`bad stage key ${key}`)
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
  ipcMain.handle('dialog:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
}
