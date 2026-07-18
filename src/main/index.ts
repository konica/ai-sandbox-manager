import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { openStore } from './store/db'
import { createSbxAdapter, defaultSpawn } from './sbx/adapter'
import { systemProbes } from './probes'
import { registerIpc } from './ipc'
import { openHostTerminal } from './terminal'
import { createLogger } from './log'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const store = openStore(join(app.getPath('userData'), 'sandbox-manager.db'))
  const logFile = join(app.getPath('userData'), 'sandbox-manager.log')
  const logger = createLogger({ file: logFile })
  logger.info(`AI Sandbox Manager started — logging sbx activity to ${logFile}`)
  const adapter = createSbxAdapter(defaultSpawn, logger)
  registerIpc({ adapter, store, probes: systemProbes, openTerminal: (c) => openHostTerminal(c), log: logger })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
