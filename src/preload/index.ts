import { contextBridge, ipcRenderer } from 'electron'
import type { DefinitionSpec } from '@shared/types'

const api = {
  prereqCheck: () => ipcRenderer.invoke('prereq:check'),
  instancesList: () => ipcRenderer.invoke('instances:list'),
  defCreate: (spec: DefinitionSpec) => ipcRenderer.invoke('def:create', spec),
  defList: () => ipcRenderer.invoke('def:list')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
