import { spawn as nodeSpawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Build a throwaway VS Code workspace file that opens `workspaceDir` and auto-runs
 * `command` (the sbx chain) in an integrated terminal via a folderOpen task. The
 * `task.allowAutomaticTasks` setting removes the automatic-tasks prompt; VS Code
 * Workspace Trust still applies on a never-opened folder (one-time click).
 *
 * The sbx chain is POSIX-shell shaped (single-quoted args, `&&`/`;`, and POSIX constructs
 * like `unset SSH_AUTH_SOCK ;` on the SSH-forward opt-out path). A `type: shell` task runs
 * in VS Code's default integrated shell — PowerShell on Windows — which cannot parse those
 * POSIX constructs. So when a `bash` path is supplied (Windows, where
 * openVSCode resolves Git Bash/WSL, mirroring openHostTerminal) we run the chain through a
 * `type: process` task: process tasks spawn the executable with LITERAL args — no shell
 * re-parse — so the whole quoted chain reaches `bash -lc` intact. Without a bash path
 * (macOS/Linux, whose default shell is already POSIX) the shell task behaves as before.
 */
export function buildCodeWorkspace(workspaceDir: string, sandboxName: string, command: string, bash?: string | null): string {
  const runner = bash
    ? { type: 'process', command: bash, args: ['-lc', command] }
    : { type: 'shell', command }
  return JSON.stringify({
    folders: [{ path: workspaceDir }],
    settings: { 'task.allowAutomaticTasks': 'on' },
    tasks: {
      version: '2.0.0',
      tasks: [{
        label: `AI Sandbox: ${sandboxName}`,
        ...runner,
        runOptions: { runOn: 'folderOpen' },
        presentation: { panel: 'dedicated', focus: true },
        problemMatcher: []
      }]
    }
  }, null, 2)
}

// On Windows the `code` CLI is `code.cmd` (a batch shim). Node's spawn/spawnSync go
// through CreateProcess, which can't execute .cmd/.bat and ignores PATHEXT — so a bare
// spawn('code') throws ENOENT even when VS Code is installed and on PATH. Running
// through cmd.exe (shell:true) lets PATHEXT resolve code.cmd. Exported for tests.
export function shellForCode(platform: string = process.platform): boolean {
  return platform === 'win32'
}

const CODE = 'code'

/**
 * VS Code's default Windows install locations, in the order its installers use: User setup
 * (the default download) under %LOCALAPPDATA%, then System setup under Program Files.
 */
function windowsCodePaths(env: NodeJS.ProcessEnv): string[] {
  const rel = join('Microsoft VS Code', 'bin', 'code.cmd')
  return [
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', rel)] : []),
    join(env.ProgramFiles ?? 'C:\\Program Files', rel),
    join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', rel)
  ]
}

/**
 * Resolve an invocable `code` command, or null when VS Code cannot be found.
 *
 * PATH first, then — on Windows only — the well-known install dirs. That fallback is not
 * belt-and-braces: this app gets no PATH repair on Windows (index.ts merges the login
 * shell's PATH only on non-win32, since mergePaths is ':'-separated and would shred `C:\…`
 * entries), and a GUI process launched by Explorer inherits the environment Explorer had at
 * login. So VS Code installed without "Add to PATH", or installed while the session was
 * already running, is present but invisible to a PATH-only probe. Mirrors findWindowsBash,
 * which probes Git for Windows' install dirs for exactly the same reason.
 *
 * macOS/Linux keep PATH-only semantics: there `code` is a shim the user installs on purpose
 * ("Shell Command: Install 'code' command in PATH"), so its absence is a deliberate state.
 */
export function resolveCodeCommand(opts: {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  exists?: (p: string) => boolean
  run?: (cmd: string, args: string[]) => { status: number | null }
} = {}): string | null {
  const platform = opts.platform ?? process.platform
  const run = opts.run ?? ((c, a) => spawnSync(c, a, { stdio: 'ignore', shell: shellForCode(platform) }))
  try {
    if (run(CODE, ['--version']).status === 0) return CODE
  } catch {
    // Not on PATH (ENOENT) — fall through to the install-dir probe.
  }
  if (platform !== 'win32') return null
  const exists = opts.exists ?? existsSync
  for (const p of windowsCodePaths(opts.env ?? process.env)) if (exists(p)) return p
  return null
}

/** Whether VS Code can be launched at all (checked per-use; cheap). */
export function codeCliPresent(
  run?: (cmd: string, args: string[]) => { status: number | null },
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; exists?: (p: string) => boolean } = {}
): boolean {
  return resolveCodeCommand({ ...opts, run }) !== null
}

/**
 * Split a resolved command into the (file, args) pair to spawn. With a shell, the shell
 * re-parses the joined command line, so any token containing whitespace must be quoted —
 * an install-dir path contains a space ("Microsoft VS Code") and would otherwise be split
 * at `…\Programs\Microsoft`. But quote ONLY when needed: quoting a bare command name like
 * `code` (what resolveCodeCommand returns when VS Code is on PATH) breaks the launch —
 * cmd.exe runs `""code" …"`, and the surrounding quotes make code.cmd's `%~dp0` resolve
 * against the CWD, so its internal `"%~dp0..\Code.exe"` misses and the spawn exits 9009
 * ("not recognized") with VS Code never opening. Without a shell, pass verbatim.
 */
export function buildCodeSpawn(cmd: string, args: string[], shell: boolean): { file: string; args: string[] } {
  if (!shell) return { file: cmd, args }
  const quote = (s: string): string => (/\s/.test(s) ? `"${s}"` : s)
  return { file: quote(cmd), args: args.map(quote) }
}

export type SpawnCodeFn = (cmd: string, args: string[]) => void
const defaultSpawn: SpawnCodeFn = (cmd, args) => {
  const shell = shellForCode()
  const { file, args: finalArgs } = buildCodeSpawn(cmd, args, shell)
  const child = nodeSpawn(file, finalArgs, { stdio: 'ignore', detached: true, shell })
  child.unref()
}

/**
 * Open a generated `.code-workspace` file in VS Code, launching whatever
 * `resolveCodeCommand` found — spawning bare `code` for a VS Code detected off PATH would
 * leave the button enabled and silently do nothing.
 */
export function openInVSCode(
  workspaceFile: string,
  spawn: SpawnCodeFn = defaultSpawn,
  resolve: () => string | null = () => resolveCodeCommand()
): void {
  spawn(resolve() ?? CODE, [workspaceFile])
}
