import { app, BrowserWindow, Menu, safeStorage, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { execFileSync } from 'node:child_process'
import * as nodeFs from 'node:fs'
import { openStore } from './store/db'
import { createSbxAdapter, defaultSpawn } from './sbx/adapter'
import { systemProbes } from './probes'
import { registerIpc } from './ipc'
import { openHostTerminal, findWindowsBash } from './terminal'
import { createLogger } from './log'
import { createSafeStorageVault, storageStatus } from './creds/vault'
import { createCredentialManager } from './creds/manager'
import { buildKitSpec, buildLoginKit } from './kit/generate'
import { buildCodeWorkspace, openInVSCode } from './vscode'
import { writeKit } from './kit/write'
import { runSmoke } from './smoke'
import { mergePaths } from './env-path'
import { createCaptureSession } from './capture/session'
import { createBeforeQuitHandler } from './capture/quit'
import { spawnSshChild } from './capture/spawn'
import { readBurpSettings } from './capture/settings'
import { readCaFile } from './capture/ca'
import { tcpProbe } from './capture/verify'
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

// Native Save/Open dialogs for definition import/export (bundle .sbx.json files).
const SBX_FILTER = [{ name: 'Sandbox definitions', extensions: ['sbx.json', 'json'] }]
async function saveFile(defaultName: string, contents: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const res = win
    ? await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: SBX_FILTER })
    : await dialog.showSaveDialog({ defaultPath: defaultName, filters: SBX_FILTER })
  if (res.canceled || !res.filePath) return null
  nodeFs.writeFileSync(res.filePath, contents, 'utf8')
  return res.filePath
}
async function openFile(): Promise<{ path: string; contents: string } | null> {
  const win = BrowserWindow.getFocusedWindow()
  const opts = { properties: ['openFile' as const], filters: SBX_FILTER }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || res.filePaths.length === 0) return null
  return { path: res.filePaths[0], contents: nodeFs.readFileSync(res.filePaths[0], 'utf8') }
}

// Remove the generated <workspace>/.sandbox dir when an instance is removed. It holds only
// generated artifacts (allowlist kit, code-workspace) and is re-created at the next launch.
function cleanupKit(workspaceDir: string): void {
  nodeFs.rmSync(`${workspaceDir}/.sandbox`, { recursive: true, force: true })
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
  // The sbx chain is POSIX-shell shaped; on Windows VS Code would run a shell task in
  // PowerShell (which can't parse POSIX constructs like `unset SSH_AUTH_SOCK ;`), so
  // run it through Git Bash/WSL instead — same shell the Terminal opener uses. null on
  // macOS/Linux (default shell is already POSIX) and on Windows without a bash installed.
  const bash = process.platform === 'win32' ? findWindowsBash() : null
  nodeFs.writeFileSync(file, buildCodeWorkspace(workspaceDir, sandboxName, command, bash), { mode: 0o644 })
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

// Colors for the Windows/Linux Window-Controls-Overlay (native min/max/close
// buttons), mirrored from --bg-surface/--text-secondary in theme/app.css. The
// overlay is drawn by the OS, not the renderer, so it can't follow the app's
// light/dark toggle via CSS — main process must push updates via IPC instead.
const OVERLAY_DARK = { color: '#141414', symbolColor: '#a0a0a0', height: 44 }
const OVERLAY_LIGHT = { color: '#f8f8fa', symbolColor: '#5c5c66', height: 44 }

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  // The renderer draws its own .titlebar, so we hide the native one on every
  // platform. 'hiddenInset' is macOS-only — on Windows/Linux it was silently
  // ignored, leaving a standard framed window *plus* Electron's default menu
  // bar stacked above our custom titlebar (the doubled/"broken" UI). Use the
  // cross-platform 'hidden' style, with macOS keeping its inset traffic lights
  // and Windows/Linux getting a Window-Controls-Overlay drawn over the titlebar.
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: '#0d0d0d',
    icon: process.platform === 'linux' ? join(__dirname, '../../build/icon.png') : undefined,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 15 } }
      : { titleBarOverlay: OVERLAY_DARK }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())
  // Fallback: ready-to-show can silently fail on Windows when titleBarOverlay
  // + backgroundColor + show:false are combined (compositor skips the first
  // paint for hidden windows). Show on did-finish-load if still hidden.
  win.webContents.on('did-finish-load', () => { if (!win.isVisible()) win.show() })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Packaged-app smoke test: when SBX_SMOKE_TEST is set, exercise the native
  // module and exit before opening a window. Used by scripts/smoke.mjs in CI.
  if (process.env.SBX_SMOKE_TEST) {
    try {
      const ok = runSmoke()
      console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL')
      app.exit(ok ? 0 : 1)
    } catch (e) {
      console.error('SMOKE FAIL:', (e as Error).message)
      app.exit(1)
    }
    return
  }
  // Repair PATH for a Finder/Explorer-launched app: it inherits a minimal PATH
  // that omits Homebrew etc., so the prereq probes and the sbx adapter can't find
  // docker/sbx/code. Merge in the login shell's PATH before anything spawns.
  if (process.platform !== 'win32') {
    process.env.PATH = mergePaths(readLoginEnv().PATH, process.env.PATH)
  }
  // The app has no use for Electron's default menu (File/Edit/View/Window/Help).
  // On Windows/Linux it renders as an in-window menu bar above our custom
  // titlebar; strip it there. macOS keeps a menu (its global menu bar carries
  // Cmd+Q, copy/paste, etc.), so leave the default in place on darwin.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  // macOS has no titleBarOverlay (traffic lights aren't recolorable this way),
  // so only listen on platforms where the window was actually created with one.
  if (process.platform !== 'darwin') {
    ipcMain.on('theme:setOverlay', (event, light: boolean) => {
      BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(light ? OVERLAY_LIGHT : OVERLAY_DARK)
    })
  }
  const store = openStore(join(app.getPath('userData'), 'sandbox-manager.db'))
  const logFile = join(app.getPath('userData'), 'sandbox-manager.log')
  const logger = createLogger({ file: logFile })
  logger.info(`AI Sandbox Manager started — logging sbx activity to ${logFile}`)
  const adapter = createSbxAdapter(defaultSpawn, logger)
  const vault = createSafeStorageVault({
    dir: join(app.getPath('userData'), 'vault'),
    safeStorage,
    platform: process.platform,
    fs: {
      mkdir: (p) => nodeFs.mkdirSync(p, { recursive: true }),
      writeFile: (p, data, mode) => nodeFs.writeFileSync(p, data, { mode }),
      readFile: (p) => (nodeFs.existsSync(p) ? nodeFs.readFileSync(p) : null),
      rm: (p) => { if (nodeFs.existsSync(p)) nodeFs.rmSync(p) }
    }
  })
  const creds = createCredentialManager({ adapter, vault, store })
  const capture = createCaptureSession({
    exec: (sandbox, script) => adapter.execScript(sandbox, script),
    execCapture: (sandbox, script) => adapter.execCapture(sandbox, script),
    settings: () => readBurpSettings(store),
    readCa: readCaFile,
    spawnSsh: spawnSshChild,
    probe: (port) => tcpProbe(port),
    log: logger
  })
  registerIpc({ adapter, store, probes: systemProbes, openTerminal: (c) => openHostTerminal(c), creds, materializeKit, readLoginEnv, loginKitDir, openVSCode, cleanupKit, saveFile, openFile, log: logger, storageStatus: () => storageStatus(process.platform, safeStorage), capture })
  // Capture never survives the app: quitting removes the sandbox's port file so new shells
  // fall back to the stock sbx proxy. There is no persistence and no auto-resume.
  // The quit is deferred until teardown finishes — see createBeforeQuitHandler for why a
  // fire-and-forget disable() silently orphaned an in-sandbox relay on every quit.
  app.on('before-quit', createBeforeQuitHandler({ disable: () => capture.disable(), quit: () => app.quit() }))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
