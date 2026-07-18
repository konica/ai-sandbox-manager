import { contextBridge } from 'electron'

// Real IPC methods are added in Task 7. This stub establishes the bridge.
contextBridge.exposeInMainWorld('api', {})
