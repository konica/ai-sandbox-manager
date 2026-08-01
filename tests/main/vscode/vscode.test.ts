import { describe, it, expect, vi } from 'vitest'
import { buildCodeSpawn, buildCodeWorkspace, codeCliPresent, openInVSCode, resolveCodeCommand, shellForCode } from '../../../src/main/vscode'

// VS Code's Windows installers: User setup lands in %LOCALAPPDATA%, System setup in
// Program Files. Both bin dirs contain a space ("Microsoft VS Code"), which matters for
// how the resolved command is spawned.
// path.join uses the host separator, so compare separator-agnostically — the test must pass
// whether it runs on Windows (\) or the Linux/mac CI host (/). Same convention as
// findWindowsBash's tests in terminal.test.ts.
const norm = (p: string): string => p.replace(/\\/g, '/')
const USER_SETUP = 'C:/Users/u/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd'
const SYSTEM_SETUP = 'C:/Program Files/Microsoft VS Code/bin/code.cmd'
const WIN_ENV = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }
const notOnPath = (): { status: number | null } => ({ status: 1 })

describe('buildCodeWorkspace', () => {
  const json = buildCodeWorkspace('/home/u/alpha', 'my-project', 'sbx create claude /home/u/alpha && sbx run --name my-project')
  const obj = JSON.parse(json)
  it('points at the workspace folder', () => {
    expect(obj.folders).toEqual([{ path: '/home/u/alpha' }])
  })
  it('allows automatic tasks so the folderOpen task runs without a prompt', () => {
    expect(obj.settings['task.allowAutomaticTasks']).toBe('on')
  })
  it('runs the sbx chain via a folderOpen task', () => {
    const task = obj.tasks.tasks[0]
    expect(task.runOptions.runOn).toBe('folderOpen')
    expect(task.command).toContain('sbx run --name my-project')
    expect(task.label).toBe('AI Sandbox: my-project')
  })
})

describe('codeCliPresent', () => {
  it('true when `code --version` exits 0', () => {
    expect(codeCliPresent(() => ({ status: 0 }))).toBe(true)
  })
  // Pin platform/env/exists: unpinned, this probes the real machine, so a Windows dev box
  // with VS Code installed finds it via the install-dir fallback and the test wrongly sees `true`.
  it('false when it errors or is missing', () => {
    const opts = { platform: 'win32' as const, env: WIN_ENV, exists: () => false }
    expect(codeCliPresent(() => ({ status: 1 }), opts)).toBe(false)
    expect(codeCliPresent(() => { throw new Error('ENOENT') }, opts)).toBe(false)
  })
  // The reported bug, at the level the IPC handler actually calls.
  it('true on Windows when VS Code is installed but not on PATH', () => {
    expect(codeCliPresent(notOnPath, { platform: 'win32', env: WIN_ENV, exists: (p) => norm(p) === USER_SETUP })).toBe(true)
  })
})

describe('shellForCode', () => {
  // On Windows `code` is code.cmd; spawning it needs a shell or CreateProcess
  // throws ENOENT and VS Code is wrongly reported as missing.
  it('uses a shell on Windows', () => {
    expect(shellForCode('win32')).toBe(true)
  })
  it('does not use a shell on macOS/Linux', () => {
    expect(shellForCode('darwin')).toBe(false)
    expect(shellForCode('linux')).toBe(false)
  })
})

describe('openInVSCode', () => {
  it('spawns `code <workspaceFile>`', () => {
    const spawn = vi.fn()
    openInVSCode('/home/u/alpha/.sandbox/my-project.code-workspace', spawn, () => 'code')
    expect(spawn).toHaveBeenCalledWith('code', ['/home/u/alpha/.sandbox/my-project.code-workspace'])
  })
  // Detection and launch must agree: if VS Code was found at a well-known Windows path
  // (not on PATH), spawning bare `code` would fail — the button would look enabled and
  // then do nothing.
  it('spawns the resolved command, not bare `code`, when VS Code was found off PATH', () => {
    const spawn = vi.fn()
    openInVSCode('C:\\p\\.sandbox\\x.code-workspace', spawn, () => USER_SETUP)
    expect(spawn).toHaveBeenCalledWith(USER_SETUP, ['C:\\p\\.sandbox\\x.code-workspace'])
  })
})

// Root cause of "VS Code is installed but the app says it isn't": resolution went only
// through the app process's PATH. On Windows the app performs no PATH repair (mergePaths is
// ':'-separated, so index.ts guards it to non-win32), and a GUI process launched by Explorer
// keeps the pre-install PATH until logout — so an installed VS Code was undetectable.
describe('resolveCodeCommand', () => {
  it('uses `code` from PATH when it responds', () => {
    expect(resolveCodeCommand({ platform: 'win32', run: () => ({ status: 0 }), env: WIN_ENV, exists: () => false })).toBe('code')
  })
  it('falls back to the User-setup install dir on Windows when `code` is not on PATH', () => {
    const found = resolveCodeCommand({ platform: 'win32', run: notOnPath, env: WIN_ENV, exists: (p) => norm(p) === USER_SETUP })
    expect(found).not.toBeNull()
    expect(norm(found as string)).toBe(USER_SETUP)
  })
  it('falls back to the System-setup install dir on Windows', () => {
    const found = resolveCodeCommand({ platform: 'win32', run: notOnPath, env: WIN_ENV, exists: (p) => norm(p) === SYSTEM_SETUP })
    expect(norm(found as string)).toBe(SYSTEM_SETUP)
  })
  it('recovers when the PATH probe throws rather than exiting non-zero', () => {
    const run = (): { status: number | null } => { throw new Error('ENOENT') }
    const found = resolveCodeCommand({ platform: 'win32', run, env: WIN_ENV, exists: (p) => norm(p) === USER_SETUP })
    expect(norm(found as string)).toBe(USER_SETUP)
  })
  it('returns null on Windows when VS Code is genuinely absent', () => {
    expect(resolveCodeCommand({ platform: 'win32', run: notOnPath, env: WIN_ENV, exists: () => false })).toBeNull()
  })
  it('does not probe install dirs on macOS/Linux — `code` there is a user-installed PATH shim', () => {
    let probed = false
    const exists = (): boolean => { probed = true; return true }
    expect(resolveCodeCommand({ platform: 'darwin', run: notOnPath, env: {}, exists })).toBeNull()
    expect(probed).toBe(false)
  })
})

describe('buildCodeSpawn', () => {
  // A resolved install-dir path contains a space ("Microsoft VS Code"), so under a shell it
  // must be quoted or cmd.exe splits it — "'C:\Users\u\AppData\Local\Programs\Microsoft' is not recognized".
  it('quotes a spaced command path and spaced args when going through a Windows shell', () => {
    expect(buildCodeSpawn(USER_SETUP, ['C:\\p\\x y.code-workspace'], true))
      .toEqual({ file: `"${USER_SETUP}"`, args: ['"C:\\p\\x y.code-workspace"'] })
  })
  // Regression (VS Code never opens on Windows): when `code` is on PATH, resolveCodeCommand
  // returns the bare name `code`. Quoting a bare name under a shell is not belt-and-braces —
  // it breaks the launch: cmd.exe runs `""code" …"`, and the extra quotes make code.cmd's
  // `%~dp0` resolve against the CWD, so its internal `"%~dp0..\Code.exe"` misses and the spawn
  // exits 9009 ("not recognized"). A token with no whitespace must be passed unquoted.
  it('does NOT quote a bare command name (no space) — quoting it breaks code.cmd', () => {
    expect(buildCodeSpawn('code', ['C:\\p\\x y.code-workspace'], true))
      .toEqual({ file: 'code', args: ['"C:\\p\\x y.code-workspace"'] })
  })
  it('passes verbatim without a shell (macOS/Linux)', () => {
    expect(buildCodeSpawn('code', ['/p/x.code-workspace'], false))
      .toEqual({ file: 'code', args: ['/p/x.code-workspace'] })
  })
})
