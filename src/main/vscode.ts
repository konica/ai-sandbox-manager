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

/** Whether the `code` CLI is on PATH (checked per-use; cheap). */
export function codeCliPresent(
  run: (cmd: string, args: string[]) => { status: number | null } = (c, a) => spawnSync(c, a, { stdio: 'ignore' })
): boolean {
  try {
    return run('code', ['--version']).status === 0
  } catch {
    return false
  }
}

export type SpawnCodeFn = (cmd: string, args: string[]) => void
const defaultSpawn: SpawnCodeFn = (cmd, args) => {
  const child = nodeSpawn(cmd, args, { stdio: 'ignore', detached: true })
  child.unref()
}

/** Open a generated `.code-workspace` file in VS Code. */
export function openInVSCode(workspaceFile: string, spawn: SpawnCodeFn = defaultSpawn): void {
  spawn('code', [workspaceFile])
}
