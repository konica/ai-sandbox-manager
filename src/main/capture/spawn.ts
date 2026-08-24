import { spawn } from 'node:child_process'
import type { CaptureChild } from './session'

/**
 * Spawn the supervised ssh child that holds the `-L` forward and carries the relay command.
 *
 * The app holds this PID, so teardown is a direct kill — no process-matching by command line
 * is ever needed. (`cmd` is injectable purely so the test can substitute a trivial process.)
 */
export function spawnSshChild(args: string[], cmd = 'ssh'): CaptureChild {
  const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true })
  let dead = false
  child.on('exit', () => { dead = true })
  // A spawn failure (no ssh on PATH) must not crash the main process; the session's
  // listener probe will fail and report the phase instead.
  child.on('error', () => { dead = true })
  return {
    kill: () => { if (!dead) { try { child.kill() } catch { /* already gone */ } } },
    onExit: (cb) => { child.on('exit', cb); child.on('error', cb) }
  }
}
