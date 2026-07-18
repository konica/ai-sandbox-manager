import { spawn } from 'child_process'
import { statfs } from 'fs'
import type { Probes } from './prereq'

function tryCmd(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args)
    let out = ''
    c.stdout?.on('data', (d) => (out += d.toString()))
    c.stderr?.on('data', (d) => (out += d.toString()))
    c.on('error', () => resolve({ code: 127, out: '' }))
    c.on('close', (code) => resolve({ code: code ?? 0, out }))
  })
}

export const systemProbes: Probes = {
  hasDocker: async () => (await tryCmd('docker', ['--version'])).code === 0,
  sbxVersion: async () => {
    const r = await tryCmd('sbx', ['--version'])
    return r.code === 0 ? r.out.trim() : null
  },
  sbxAuthed: async () => (await tryCmd('sbx', ['ls', '--json'])).code === 0,
  freeDiskBytes: () =>
    new Promise((resolve) => {
      statfs(process.env.HOME || '/', (err, s) => resolve(err ? 0 : Number(s.bavail) * Number(s.bsize)))
    }),
  keychainReachable: async () => process.platform === 'darwin' || process.platform === 'win32'
}
