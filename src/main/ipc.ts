import { ipcMain } from 'electron'
import type { Result, PrereqResult, InstanceView } from '@shared/types'
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
} {
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(() => reconcile(deps.adapter, deps.store))
  }
}

export function registerIpc(deps: Deps): void {
  const handlers = buildHandlers(deps)
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, () => handler())
  }
}
