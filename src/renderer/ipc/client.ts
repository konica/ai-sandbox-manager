import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition } from '@shared/types'

interface Api {
  prereqCheck(): Promise<Result<PrereqResult>>
  instancesList(): Promise<Result<InstanceView[]>>
  defCreate(spec: DefinitionSpec): Promise<Result<{ id: string }>>
  defList(): Promise<Result<Definition[]>>
  pickFolder(): Promise<string | null>
  instanceLaunch(definitionId: string): Promise<Result<{ name: string }>>
  instanceAttach(name: string): Promise<Result<null>>
  instanceShell(name: string): Promise<Result<null>>
  instanceStop(name: string): Promise<Result<null>>
  instanceRemove(name: string): Promise<Result<null>>
}

export const api: Api = (globalThis as unknown as { api?: Api }).api ?? {
  prereqCheck: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancesList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defCreate: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  pickFolder: async () => null,
  instanceLaunch: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceAttach: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceShell: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceStop: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceRemove: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } })
}
