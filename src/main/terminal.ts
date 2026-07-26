import { spawn as nodeSpawn } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

// The sbx command strings are POSIX-shell shaped (single-quoted args via shellQuote,
// `;`/`&&` chaining), so on Windows we run them in a real bash (Git for Windows / WSL)
// where they behave exactly as on macOS. Locate one: PATH takes precedence (a `bash`
// resolved by the OS covers WSL and a PATH-added Git Bash), then Git for Windows'
// default install locations. Returns null when none is found (caller uses PowerShell).
export function findWindowsBash(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync
): string | null {
  const known = [
    join(env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe')] : [])
  ]
  for (const p of known) if (exists(p)) return p
  return null
}

// Wrap the POSIX command in a throwaway script so the (heavily single-quoted) command
// never has to survive a Windows command-line round-trip — only the script's own path,
// which we control, is passed as an argument. `exec bash -i` at the end keeps the
// window open on an interactive prompt after the command exits, mirroring Terminal.app.
export function buildBashScript(command: string): string {
  return `#!/usr/bin/env bash\n${command}\nexec bash -i\n`
}

function defaultWriteScript(content: string): string {
  const dir = join(tmpdir(), 'sbx-term')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `term-${Date.now()}.sh`)
  writeFileSync(file, content, { mode: 0o700 })
  return file
}

export function openHostTerminal(
  command: string,
  opts: {
    platform?: NodeJS.Platform
    spawn?: SpawnTermFn
    env?: NodeJS.ProcessEnv
    findBash?: (env: NodeJS.ProcessEnv) => string | null
    writeScript?: (content: string) => string
  } = {}
): void {
  const platform = opts.platform ?? process.platform
  const spawn = opts.spawn ?? defaultSpawn

  if (platform === 'darwin') {
    spawn('osascript', buildOsascriptArgs(command))
    return
  }

  if (platform === 'win32') {
    const env = opts.env ?? process.env
    const bash = (opts.findBash ?? findWindowsBash)(env)
    // `cmd /c start "" <prog> <args…>` opens <prog> in its own new console window;
    // the empty first token is the window title (start's quirk). Node quotes the
    // path args, so spaces in Program Files / temp paths are handled.
    if (bash) {
      const script = (opts.writeScript ?? defaultWriteScript)(buildBashScript(command))
      spawn('cmd.exe', ['/c', 'start', '', bash, script])
    } else {
      // No bash: fall back to PowerShell. Single-quoted args and `;` behave, but the
      // launch flow's `&&` chaining fails on Windows PowerShell 5.1 (pwsh 7+ is fine).
      spawn('cmd.exe', ['/c', 'start', '', 'powershell', '-NoExit', '-Command', command])
    }
    return
  }

  throw new SbxError('generic', 'Opening a host terminal is only supported on macOS and Windows in this version.')
}
