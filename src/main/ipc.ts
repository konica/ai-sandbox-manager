import { ipcMain } from 'electron'
import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { checkPrereqs, type Probes } from './prereq'
import { reconcile } from './reconciler'

interface Deps { adapter: SbxAdapter; store: Store; probes: Probes }

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
} {
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(() => reconcile(deps.adapter, deps.store)),
    'def:create': (spec) => wrap(async () => { deps.store.insertDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:list': () => wrap(async () => deps.store.listDefinitions())
  }
}

export function registerIpc(deps: Deps): void {
  const handlers = buildHandlers(deps)
  ipcMain.handle('prereq:check', () => handlers['prereq:check']())
  ipcMain.handle('instances:list', () => handlers['instances:list']())
  ipcMain.handle('def:create', (_e, spec: DefinitionSpec) => handlers['def:create'](spec))
  ipcMain.handle('def:list', () => handlers['def:list']())
}
