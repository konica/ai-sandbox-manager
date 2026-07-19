import { contextBridge, ipcRenderer } from 'electron'
import type { DefinitionSpec } from '@shared/types'

const api = {
  prereqCheck: () => ipcRenderer.invoke('prereq:check'),
  instancesList: () => ipcRenderer.invoke('instances:list'),
  defCreate: (spec: DefinitionSpec) => ipcRenderer.invoke('def:create', spec),
  defUpdate: (spec: DefinitionSpec) => ipcRenderer.invoke('def:update', spec),
  defGetSpec: (id: string) => ipcRenderer.invoke('def:getSpec', id),
  defList: () => ipcRenderer.invoke('def:list'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  instanceLaunch: (definitionId: string, name?: string, sessionName?: string) => ipcRenderer.invoke('instance:launch', definitionId, name, sessionName),
  instanceAttach: (name: string) => ipcRenderer.invoke('instance:attach', name),
  instanceShell: (name: string) => ipcRenderer.invoke('instance:shell', name),
  instanceStop: (name: string) => ipcRenderer.invoke('instance:stop', name),
  instanceRemove: (name: string) => ipcRenderer.invoke('instance:remove', name),
  secretListGlobal: () => ipcRenderer.invoke('secret:listGlobal'),
  secretSetGlobal: (serviceId: string, value: string) => ipcRenderer.invoke('secret:setGlobal', serviceId, value),
  secretRemoveGlobal: (id: string) => ipcRenderer.invoke('secret:removeGlobal', id),
  credScanEnv: () => ipcRenderer.invoke('cred:scanEnv'),
  credStageValue: (key: string, value: string) => ipcRenderer.invoke('cred:stageValue', key, value),
  credStageFromEnv: (key: string, serviceId: string) => ipcRenderer.invoke('cred:stageFromEnv', key, serviceId)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
