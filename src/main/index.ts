import { app, BrowserWindow, safeStorage } from 'electron'
import { join } from 'path'
import { execFileSync } from 'node:child_process'
import * as nodeFs from 'node:fs'
import { openStore } from './store/db'
import { createSbxAdapter, defaultSpawn } from './sbx/adapter'
import { systemProbes } from './probes'
import { registerIpc } from './ipc'
import { openHostTerminal } from './terminal'
import { createLogger } from './log'
import { createSafeStorageVault } from './creds/vault'
import { createCredentialManager } from './creds/manager'

// GUI apps on macOS don't inherit the shell's env, so read it from a login shell.
function readLoginEnv(): Record<string, string | undefined> {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-lic', 'env'], { encoding: 'utf8', timeout: 4000 })
    const env: Record<string, string> = {}
    for (const line of out.split('\n')) { const i = line.indexOf('='); if (i > 0) env[line.slice(0, i)] = line.slice(i + 1) }
    return env
  } catch {
    return process.env
  }
}

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
  const vault = createSafeStorageVault({
    dir: join(app.getPath('userData'), 'vault'),
    safeStorage,
    fs: {
      mkdir: (p) => nodeFs.mkdirSync(p, { recursive: true }),
      writeFile: (p, data, mode) => nodeFs.writeFileSync(p, data, { mode }),
      readFile: (p) => (nodeFs.existsSync(p) ? nodeFs.readFileSync(p) : null),
      rm: (p) => { if (nodeFs.existsSync(p)) nodeFs.rmSync(p) }
    }
  })
  const creds = createCredentialManager({ adapter, vault, store })
  registerIpc({ adapter, store, probes: systemProbes, openTerminal: (c) => openHostTerminal(c), creds, readLoginEnv, log: logger })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
