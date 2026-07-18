import { spawn as nodeSpawn } from 'child_process'
import { SbxError } from '@shared/errors'

export type SpawnTermFn = (cmd: string, args: string[]) => void

const defaultSpawn: SpawnTermFn = (cmd, args) => {
  const child = nodeSpawn(cmd, args, { stdio: 'ignore', detached: true })
  child.unref()
}

/**
 * Build `osascript -e … -e …` args that open Terminal.app, run `command`, and
 * bring Terminal to the foreground so the user can type immediately. Each
 * AppleScript statement is passed as its own `-e` flag.
 */
export function buildOsascriptArgs(command: string): string[] {
  // AppleScript string literal is double-quoted; escape backslashes then quotes.
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    '-e', 'tell application "Terminal"',
    '-e', `do script "${escaped}"`,
    '-e', 'activate',
    '-e', 'end tell'
  ]
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
