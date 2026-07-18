import type { Result, PrereqResult, InstanceView } from '@shared/types'

interface Api {
  prereqCheck(): Promise<Result<PrereqResult>>
  instancesList(): Promise<Result<InstanceView[]>>
}

export const api: Api = (globalThis as unknown as { api?: Api }).api ?? {
  prereqCheck: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancesList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } })
}
