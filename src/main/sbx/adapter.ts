import { spawn } from 'child_process'
import type { SbxInstance, DefinitionSpec, PortIntent, Tier } from '@shared/types'
import { SbxError, classifySbxError } from '@shared/errors'
import { parseSbxLsJson, parseSbxLsText } from './parse'
import { specToCreateArgs, tierToAllowlist, portIntentToPublishSpec } from './translate'
import type { Logger } from '../log'

export interface SbxResult { stdout: string; stderr: string; code: number }

export type SpawnFn = (cmd: string, args: string[], opts: { stdin?: string }) => Promise<SbxResult>

export interface SbxAdapter {
  runSbx(args: string[], opts?: { stdin?: string }): Promise<SbxResult>
  listSandboxes(): Promise<SbxInstance[]>
  createSandbox(spec: DefinitionSpec): Promise<void>
  applyPolicy(name: string, tier: Tier, domains: string[]): Promise<void>
  publishPorts(name: string, ports: PortIntent[]): Promise<void>
  stopSandbox(name: string): Promise<void>
  removeSandbox(name: string): Promise<void>
  setSecret(service: string, value: string, opts: { global?: boolean; sandbox?: string }): Promise<void>
  removeSecret(service: string, opts: { global?: boolean; sandbox?: string }): Promise<void>
}

export const defaultSpawn: SpawnFn = (cmd, args, opts) =>
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

export function createSbxAdapter(spawnFn: SpawnFn = defaultSpawn, logger?: Logger): SbxAdapter {
  async function runSbx(args: string[], opts: { stdin?: string } = {}): Promise<SbxResult> {
    logger?.command(args)
    const res = await spawnFn('sbx', args, opts)
    if (res.code !== 0) {
      const detail = res.stderr.trim() || `sbx exited ${res.code}`
      logger?.error(`sbx ${args[0] ?? ''} failed (exit ${res.code}): ${detail}`)
      throw new SbxError(classifySbxError(res.code, res.stderr), detail)
    }
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

  async function createSandbox(spec: DefinitionSpec): Promise<void> {
    await runSbx(specToCreateArgs(spec))
  }

  async function applyPolicy(name: string, tier: Tier, domains: string[]): Promise<void> {
    const resources = tierToAllowlist(tier, domains)
    if (resources.length === 0) return // fully locked: no allow rule
    await runSbx(['policy', 'allow', 'network', '--sandbox', name, resources.join(',')])
  }

  async function publishPorts(name: string, ports: PortIntent[]): Promise<void> {
    for (const p of ports) {
      await runSbx(['ports', name, '--publish', portIntentToPublishSpec(p)])
    }
  }

  async function stopSandbox(name: string): Promise<void> {
    await runSbx(['stop', name])
  }

  async function removeSandbox(name: string): Promise<void> {
    await runSbx(['rm', name, '--force'])
  }

  async function setSecret(service: string, value: string, opts: { global?: boolean; sandbox?: string }): Promise<void> {
    const scope = opts.global ? ['-g'] : opts.sandbox ? [opts.sandbox] : []
    await runSbx(['secret', 'set', ...scope, service], { stdin: value })
  }

  async function removeSecret(service: string, opts: { global?: boolean; sandbox?: string }): Promise<void> {
    const scope = opts.global ? ['-g'] : opts.sandbox ? [opts.sandbox] : []
    await runSbx(['secret', 'rm', ...scope, service, '-f'])
  }

  return { runSbx, listSandboxes, createSandbox, applyPolicy, publishPorts, stopSandbox, removeSandbox, setSecret, removeSecret }
}
