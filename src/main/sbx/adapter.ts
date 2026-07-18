import { spawn } from 'child_process'
import type { SbxInstance } from '@shared/types'
import { SbxError, classifySbxError } from '@shared/errors'
import { parseSbxLsJson, parseSbxLsText } from './parse'

export interface SbxResult { stdout: string; stderr: string; code: number }

export type SpawnFn = (cmd: string, args: string[], opts: { stdin?: string }) => Promise<SbxResult>

export interface SbxAdapter {
  runSbx(args: string[], opts?: { stdin?: string }): Promise<SbxResult>
  listSandboxes(): Promise<SbxInstance[]>
}

const defaultSpawn: SpawnFn = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => reject(new SbxError('not-installed', err.message)))
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin)
      child.stdin.end()
    }
  })

export function createSbxAdapter(spawnFn: SpawnFn = defaultSpawn): SbxAdapter {
  async function runSbx(args: string[], opts: { stdin?: string } = {}): Promise<SbxResult> {
    const res = await spawnFn('sbx', args, opts)
    if (res.code !== 0) throw new SbxError(classifySbxError(res.code, res.stderr), res.stderr.trim() || `sbx exited ${res.code}`)
    return res
  }

  async function listSandboxes(): Promise<SbxInstance[]> {
    const res = await runSbx(['ls', '--json'])
    try {
      return parseSbxLsJson(res.stdout)
    } catch {
      return parseSbxLsText(res.stdout)
    }
  }

  return { runSbx, listSandboxes }
}
