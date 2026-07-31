import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition, GlobalSecretMeta, EnvHit, LivePort, PolicySummary, AuthStatus, KitValidation, StorageStatus } from '@shared/types'

interface Api {
  prereqCheck(): Promise<Result<PrereqResult>>
  instancesList(): Promise<Result<InstanceView[]>>
  defCreate(spec: DefinitionSpec): Promise<Result<{ id: string }>>
  defUpdate(spec: DefinitionSpec): Promise<Result<{ id: string }>>
  defGetSpec(id: string): Promise<Result<DefinitionSpec | null>>
  defList(): Promise<Result<Definition[]>>
  defExport(ids: string[]): Promise<Result<{ canceled?: boolean; path?: string; count?: number }>>
  defImport(): Promise<Result<{ canceled?: boolean; imported?: string[]; skipped?: number; domainWarnings?: string[] }>>
  defRemove(id: string): Promise<Result<{ removedInstances: number }>>
  pickFolder(): Promise<string | null>
  pickFile(): Promise<string | null>
  instanceLaunch(definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode'): Promise<Result<{ name: string }>>
  instanceAttach(name: string, opener?: 'terminal' | 'vscode'): Promise<Result<null>>
  instanceRebuild(name: string, opener?: 'terminal' | 'vscode'): Promise<Result<{ name: string }>>
  instanceCommands(name: string): Promise<Result<{ agent: string; shell: string }>>
  instanceShell(name: string): Promise<Result<null>>
  instanceStop(name: string): Promise<Result<null>>
  instanceRemove(name: string): Promise<Result<null>>
  secretListGlobal(): Promise<Result<GlobalSecretMeta[]>>
  secretSetGlobal(serviceId: string, value: string): Promise<Result<GlobalSecretMeta>>
  secretSetGlobalFromEnv(serviceId: string): Promise<Result<GlobalSecretMeta>>
  secretRemoveGlobal(id: string): Promise<Result<null>>
  credScanEnv(): Promise<Result<EnvHit[]>>
  credStageValue(key: string, value: string): Promise<Result<null>>
  credStageFromEnv(key: string, serviceId: string): Promise<Result<null>>
  instancePortsList(name: string): Promise<Result<LivePort[]>>
  instancePortsPublish(name: string, port: LivePort): Promise<Result<null>>
  instancePortsUnpublish(name: string, port: LivePort): Promise<Result<null>>
  instanceHostServiceAdd(name: string, hostPort: number, label: string): Promise<Result<null>>
  instanceHostServiceRemove(name: string, hostPort: number): Promise<Result<null>>
  instanceDomainAllow(name: string, domain: string): Promise<Result<null>>
  instanceDomainDeny(name: string, domain: string): Promise<Result<null>>
  instancePolicyLog(name: string): Promise<Result<PolicySummary>>
  authStatus(): Promise<Result<AuthStatus>>
  authSignOut(): Promise<Result<null>>
  authStartLogin(): Promise<Result<{ name: string }>>
  sshDetect(): Promise<Result<{ present: boolean; platform: string }>>
  envHasVSCode(): Promise<Result<{ present: boolean }>>
  kitValidate(yaml: string): Promise<Result<KitValidation>>
  prefsGet(key: string): Promise<Result<string | null>>
  prefsSet(key: string, value: string): Promise<Result<null>>
  credsStorageStatus(): Promise<Result<StorageStatus>>
  setTitleBarOverlay(light: boolean): void
}

export const api: Api = (globalThis as unknown as { api?: Api }).api ?? {
  prereqCheck: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancesList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defCreate: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defUpdate: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defGetSpec: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defExport: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defImport: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defRemove: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  pickFolder: async () => null,
  pickFile: async () => null,
  instanceLaunch: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceAttach: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceRebuild: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceShell: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceStop: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceRemove: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  secretListGlobal: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  secretSetGlobal: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  secretSetGlobalFromEnv: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  secretRemoveGlobal: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  credScanEnv: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  credStageValue: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  credStageFromEnv: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancePortsList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancePortsPublish: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancePortsUnpublish: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceHostServiceAdd: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceHostServiceRemove: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceDomainAllow: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceDomainDeny: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancePolicyLog: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  authStatus: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  authSignOut: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  authStartLogin: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  sshDetect: async () => ({ ok: true, data: { present: false, platform: '' } }),
  envHasVSCode: async () => ({ ok: true, data: { present: false } }),
  instanceCommands: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  kitValidate: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  prefsGet: async () => ({ ok: true, data: null }),
  prefsSet: async () => ({ ok: true, data: null }),
  credsStorageStatus: async () => ({ ok: true, data: { platform: 'darwin', backend: 'keychain', secure: true } }),
  setTitleBarOverlay: () => {}
}
