import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition } from '@shared/types'

interface Api {
  prereqCheck(): Promise<Result<PrereqResult>>
  instancesList(): Promise<Result<InstanceView[]>>
  defCreate(spec: DefinitionSpec): Promise<Result<{ id: string }>>
  defList(): Promise<Result<Definition[]>>
}

export const api: Api = (globalThis as unknown as { api?: Api }).api ?? {
  prereqCheck: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancesList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defCreate: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } })
}
