import { spawn as nodeSpawn, spawnSync } from 'child_process'

/**
 * Build a throwaway VS Code workspace file that opens `workspaceDir` and auto-runs
 * `command` (the sbx chain) in an integrated terminal via a folderOpen task. The
 * `task.allowAutomaticTasks` setting removes the automatic-tasks prompt; VS Code
 * Workspace Trust still applies on a never-opened folder (one-time click).
 */
export function buildCodeWorkspace(workspaceDir: string, sandboxName: string, command: string): string {
  return JSON.stringify({
    folders: [{ path: workspaceDir }],
    settings: { 'task.allowAutomaticTasks': 'on' },
    tasks: {
      version: '2.0.0',
      tasks: [{
        label: `AI Sandbox: ${sandboxName}`,
        type: 'shell',
        command,
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

/** Whether the `code` CLI is on PATH (checked per-use; cheap). */
export function codeCliPresent(
  run: (cmd: string, args: string[]) => { status: number | null } =
    (c, a) => spawnSync(c, a, { stdio: 'ignore', shell: shellForCode() })
): boolean {
  try {
    return run('code', ['--version']).status === 0
  } catch {
    return false
  }
}

export type SpawnCodeFn = (cmd: string, args: string[]) => void
const defaultSpawn: SpawnCodeFn = (cmd, args) => {
  const shell = shellForCode()
  // With shell:true the shell re-parses the joined command line, so quote args
  // (a generated workspace path may contain spaces). Without a shell, pass verbatim.
  const finalArgs = shell ? args.map((a) => `"${a}"`) : args
  const child = nodeSpawn(cmd, finalArgs, { stdio: 'ignore', detached: true, shell })
  child.unref()
}

/** Open a generated `.code-workspace` file in VS Code. */
export function openInVSCode(workspaceFile: string, spawn: SpawnCodeFn = defaultSpawn): void {
  spawn('code', [workspaceFile])
}
