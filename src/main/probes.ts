import { spawn } from 'child_process'
import { statfs } from 'fs'
import type { Probes } from './prereq'

interface CmdResult { code: number; out: string }

// Run a command with a hard timeout so a probe can never hang the UI
// (e.g. `sbx ls` blocks on the daemon socket). A timed-out or missing
// binary resolves with a non-zero code rather than rejecting.
function tryCmd(cmd: string, args: string[], timeoutMs = 15000): Promise<CmdResult> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { timeout: timeoutMs })
    let out = ''
    c.stdout?.on('data', (d) => (out += d.toString()))
    c.stderr?.on('data', (d) => (out += d.toString()))
    c.on('error', () => resolve({ code: 127, out: '' }))
    c.on('close', (code) => resolve({ code: code === null ? 124 : code, out }))
  })
}

// Strip ANSI colour codes so we can match `sbx diagnose` output text.
function stripAnsi(s: string): string {
  return s.replace(/\[[0-9;]*m/g, '')
}

export const systemProbes: Probes = {
  dockerVersion: async () => {
    const r = await tryCmd('docker', ['--version'])
    return r.code === 0 ? r.out.trim() : null
  },
  sbxVersion: async () => {
    // Docker Sandboxes uses `sbx version` (there is no `--version` flag).
    const r = await tryCmd('sbx', ['version'])
    if (r.code !== 0) return null
    const m = r.out.match(/v?\d+\.\d+\.\d+/)
    return m ? m[0] : r.out.trim()
  },
  sbxAuthed: async () => {
    // `sbx diagnose` is the authoritative, non-interactive health check; it
    // reports install, daemon, and authentication without needing `sbx ls`
    // (which blocks on the daemon socket). Look for the authenticated line.
    const r = await tryCmd('sbx', ['diagnose'])
    const text = stripAnsi(r.out)
    return text.split('\n').some((l) => /authentication/i.test(l) && /authenticated/i.test(l))
  },
  freeDiskBytes: () =>
    new Promise((resolve) => {
      statfs(process.env.HOME || '/', (err, s) => resolve(err ? 0 : Number(s.bavail) * Number(s.bsize)))
    }),
  keychainReachable: async () => process.platform === 'darwin' || process.platform === 'win32'
}
