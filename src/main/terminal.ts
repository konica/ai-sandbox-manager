import { spawn as nodeSpawn } from 'child_process'
import { SbxError } from '@shared/errors'

export type SpawnTermFn = (cmd: string, args: string[]) => void

const defaultSpawn: SpawnTermFn = (cmd, args) => {
  const child = nodeSpawn(cmd, args, { stdio: 'ignore', detached: true })
  child.unref()
}

/** Build `osascript -e '<applescript>'` args that open Terminal.app and run `command`. */
export function buildOsascriptArgs(command: string): string[] {
  // AppleScript string literal is double-quoted; escape backslashes then quotes.
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `tell application "Terminal" to do script "${escaped}"`
  return ['-e', script]
}

export function openHostTerminal(
  command: string,
  opts: { platform?: NodeJS.Platform; spawn?: SpawnTermFn } = {}
): void {
  const platform = opts.platform ?? process.platform
  const spawn = opts.spawn ?? defaultSpawn
  if (platform !== 'darwin') {
    throw new SbxError('generic', 'Opening a host terminal is only supported on macOS in this version.')
  }
  spawn('osascript', buildOsascriptArgs(command))
}
