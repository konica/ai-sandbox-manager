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
import { buildKitSpec, buildLoginKit } from './kit/generate'
import { buildCodeWorkspace, openInVSCode } from './vscode'
import { writeKit } from './kit/write'
import type { DefinitionSpec } from '@shared/types'

const kitFs = {
  mkdir: (p: string) => nodeFs.mkdirSync(p, { recursive: true }),
  writeFile: (p: string, data: string, mode: number) => nodeFs.writeFileSync(p, data, { mode }),
  readFile: (p: string) => (nodeFs.existsSync(p) ? nodeFs.readFileSync(p, 'utf8') : null),
  rm: (p: string) => { if (nodeFs.existsSync(p)) nodeFs.rmSync(p) }
}

// Write the definition's network-allowlist kit into <workspace>/.sandbox/kit (gitignored).
// Carries no secrets — injection is via `sbx secret set` / `set-custom` at launch.
function materializeKit(spec: DefinitionSpec, _name: string): string | undefined {
  const primary = spec.mounts.find((m) => m.isPrimary) ?? spec.mounts[0]
  if (!primary) return undefined
  const ws = primary.hostPath
  return writeKit(buildKitSpec(spec), {}, { fs: kitFs, kitDir: `${ws}/.sandbox/kit`, secretsDir: `${ws}/.sandbox/.unused`, gitignorePath: `${ws}/.gitignore` }).kitDir
}

// Materialize the ephemeral OAuth login kit under the OS temp dir; returns the kit dir.
// The kit only allowlists the Claude OAuth domains — carries no secrets.
function loginKitDir(): string {
  const dir = join(app.getPath('temp'), 'sbx-oauth-login')
  nodeFs.mkdirSync(dir, { recursive: true })
  const kitDir = `${dir}/.kit`
  return writeKit(buildLoginKit(), {}, { fs: kitFs, kitDir, secretsDir: `${dir}/.unused`, gitignorePath: `${dir}/.gitignore` }).kitDir
}

// Open the session in VS Code: write a throwaway .code-workspace under the workspace's
// .sandbox/ dir (auto-runs the sbx chain in an integrated terminal) and launch `code`.
function openVSCode(command: string, workspaceDir: string, sandboxName: string): void {
  const dir = `${workspaceDir}/.sandbox`
  nodeFs.mkdirSync(dir, { recursive: true })
  const file = `${dir}/${sandboxName}.code-workspace`
  nodeFs.writeFileSync(file, buildCodeWorkspace(workspaceDir, sandboxName, command), { mode: 0o644 })
  openInVSCode(file)
}

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
  registerIpc({ adapter, store, probes: systemProbes, openTerminal: (c) => openHostTerminal(c), creds, materializeKit, readLoginEnv, loginKitDir, openVSCode, log: logger })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
