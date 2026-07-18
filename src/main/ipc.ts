import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { checkPrereqs, type Probes } from './prereq'
import { reconcile } from './reconciler'
import { launchDefinition } from './launch'
import { agentAttachCommand, hostShellCommand } from './sbx/translate'
import type { Logger } from './log'

interface Deps { adapter: SbxAdapter; store: Store; probes: Probes; openTerminal: (command: string) => void; log?: Logger }

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
  'def:list': () => Promise<Result<Definition[]>>
  'instance:launch': (definitionId: string) => Promise<Result<{ name: string }>>
  'instance:attach': (name: string) => Promise<Result<null>>
  'instance:shell': (name: string) => Promise<Result<null>>
  'instance:stop': (name: string) => Promise<Result<null>>
  'instance:remove': (name: string) => Promise<Result<null>>
} {
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(() => reconcile(deps.adapter, deps.store)),
    'def:create': (spec) => wrap(async () => { deps.store.insertDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:list': () => wrap(async () => deps.store.listDefinitions()),
    'instance:launch': (definitionId) => wrap(() => launchDefinition(
      { adapter: deps.adapter, store: deps.store, openTerminal: deps.openTerminal, log: deps.log }, definitionId
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
    })
  }
}

export function registerIpc(deps: Deps): void {
  const handlers = buildHandlers(deps)
  ipcMain.handle('prereq:check', () => handlers['prereq:check']())
  ipcMain.handle('instances:list', () => handlers['instances:list']())
  ipcMain.handle('def:create', (_e, spec: DefinitionSpec) => handlers['def:create'](spec))
  ipcMain.handle('def:list', () => handlers['def:list']())
  ipcMain.handle('instance:launch', (_e, id: string) => handlers['instance:launch'](id))
  ipcMain.handle('instance:attach', (_e, name: string) => handlers['instance:attach'](name))
  ipcMain.handle('instance:shell', (_e, name: string) => handlers['instance:shell'](name))
  ipcMain.handle('instance:stop', (_e, name: string) => handlers['instance:stop'](name))
  ipcMain.handle('instance:remove', (_e, name: string) => handlers['instance:remove'](name))
  ipcMain.handle('dialog:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
}
