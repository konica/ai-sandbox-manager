import { contextBridge, ipcRenderer } from 'electron'
import type { DefinitionSpec, LivePort } from '@shared/types'

const api = {
  prereqCheck: () => ipcRenderer.invoke('prereq:check'),
  instancesList: () => ipcRenderer.invoke('instances:list'),
  defCreate: (spec: DefinitionSpec) => ipcRenderer.invoke('def:create', spec),
  defUpdate: (spec: DefinitionSpec) => ipcRenderer.invoke('def:update', spec),
  defGetSpec: (id: string) => ipcRenderer.invoke('def:getSpec', id),
  defExport: (ids: string[]) => ipcRenderer.invoke('def:export', ids),
  defImport: () => ipcRenderer.invoke('def:import'),
  defRemove: (id: string) => ipcRenderer.invoke('def:remove', id),
  defList: () => ipcRenderer.invoke('def:list'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  instanceLaunch: (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode') => ipcRenderer.invoke('instance:launch', definitionId, name, sessionName, opener),
  instanceAttach: (name: string, opener?: 'terminal' | 'vscode') => ipcRenderer.invoke('instance:attach', name, opener),
  instanceRebuild: (name: string, opener?: 'terminal' | 'vscode') => ipcRenderer.invoke('instance:rebuild', name, opener),
  instanceCommands: (name: string) => ipcRenderer.invoke('instance:commands', name),
  instanceShell: (name: string) => ipcRenderer.invoke('instance:shell', name),
  instanceStop: (name: string) => ipcRenderer.invoke('instance:stop', name),
  instanceRemove: (name: string) => ipcRenderer.invoke('instance:remove', name),
  secretListGlobal: () => ipcRenderer.invoke('secret:listGlobal'),
  secretSetGlobal: (serviceId: string, value: string) => ipcRenderer.invoke('secret:setGlobal', serviceId, value),
  secretRemoveGlobal: (id: string) => ipcRenderer.invoke('secret:removeGlobal', id),
  credScanEnv: () => ipcRenderer.invoke('cred:scanEnv'),
  credStageValue: (key: string, value: string) => ipcRenderer.invoke('cred:stageValue', key, value),
  credStageFromEnv: (key: string, serviceId: string) => ipcRenderer.invoke('cred:stageFromEnv', key, serviceId),
  instancePortsList: (name: string) => ipcRenderer.invoke('instance:ports:list', name),
  instancePortsPublish: (name: string, port: LivePort) => ipcRenderer.invoke('instance:ports:publish', name, port),
  instancePortsUnpublish: (name: string, port: LivePort) => ipcRenderer.invoke('instance:ports:unpublish', name, port),
  instanceHostServiceAdd: (name: string, hostPort: number, label: string) => ipcRenderer.invoke('instance:hostService:add', name, hostPort, label),
  instanceHostServiceRemove: (name: string, hostPort: number) => ipcRenderer.invoke('instance:hostService:remove', name, hostPort),
  instanceDomainAllow: (name: string, domain: string) => ipcRenderer.invoke('instance:domain:allow', name, domain),
  instanceDomainDeny: (name: string, domain: string) => ipcRenderer.invoke('instance:domain:deny', name, domain),
  instancePolicyLog: (name: string) => ipcRenderer.invoke('instance:policyLog', name),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authSignOut: () => ipcRenderer.invoke('auth:signOut'),
  authStartLogin: () => ipcRenderer.invoke('auth:startLogin'),
  authLaunchPrecheck: (definitionId: string) => ipcRenderer.invoke('auth:launchPrecheck', definitionId),
  sshDetect: () => ipcRenderer.invoke('ssh:detect'),
  envHasVSCode: () => ipcRenderer.invoke('env:hasVSCode')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
