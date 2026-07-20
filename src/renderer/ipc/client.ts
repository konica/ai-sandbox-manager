import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition, GlobalSecretMeta, EnvHit, LivePort, PolicySummary, AuthStatus, ClaudeAuthKind } from '@shared/types'

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
  authLaunchPrecheck(definitionId: string): Promise<Result<{ needsNudge: boolean; status: ClaudeAuthKind }>>
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
  authLaunchPrecheck: async () => ({ ok: true, data: { needsNudge: false, status: 'none' } })
}
