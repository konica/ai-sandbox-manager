import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition, GlobalSecretMeta, EnvHit } from '@shared/types'

interface Api {
  prereqCheck(): Promise<Result<PrereqResult>>
  instancesList(): Promise<Result<InstanceView[]>>
  defCreate(spec: DefinitionSpec): Promise<Result<{ id: string }>>
  defUpdate(spec: DefinitionSpec): Promise<Result<{ id: string }>>
  defGetSpec(id: string): Promise<Result<DefinitionSpec | null>>
  defList(): Promise<Result<Definition[]>>
  pickFolder(): Promise<string | null>
  instanceLaunch(definitionId: string, name?: string, sessionName?: string): Promise<Result<{ name: string }>>
  instanceAttach(name: string): Promise<Result<null>>
  instanceShell(name: string): Promise<Result<null>>
  instanceStop(name: string): Promise<Result<null>>
  instanceRemove(name: string): Promise<Result<null>>
  secretListGlobal(): Promise<Result<GlobalSecretMeta[]>>
  secretSetGlobal(serviceId: string, value: string): Promise<Result<GlobalSecretMeta>>
  secretRemoveGlobal(id: string): Promise<Result<null>>
  credScanEnv(): Promise<Result<EnvHit[]>>
  credStageValue(key: string, value: string): Promise<Result<null>>
}

export const api: Api = (globalThis as unknown as { api?: Api }).api ?? {
  prereqCheck: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancesList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defCreate: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defUpdate: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defGetSpec: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  pickFolder: async () => null,
  instanceLaunch: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceAttach: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceShell: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceStop: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceRemove: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  secretListGlobal: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  secretSetGlobal: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  secretRemoveGlobal: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  credScanEnv: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  credStageValue: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } })
}
