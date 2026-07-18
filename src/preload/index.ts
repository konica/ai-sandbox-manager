import { contextBridge, ipcRenderer } from 'electron'

const api = {
  prereqCheck: () => ipcRenderer.invoke('prereq:check'),
  instancesList: () => ipcRenderer.invoke('instances:list')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
