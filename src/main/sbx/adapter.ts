import { spawn } from 'child_process'
import type { SbxInstance, DefinitionSpec, PortIntent, Tier, LivePort } from '@shared/types'
import { SbxError, classifySbxError } from '@shared/errors'
import { parseSbxLsJson, parseSbxLsText, parsePortsJson } from './parse'
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
  listPorts(name: string): Promise<LivePort[]>
  publishPort(name: string, port: LivePort): Promise<void>
  unpublishPort(name: string, port: LivePort): Promise<void>
  allowNetwork(name: string, resource: string): Promise<void>
  removeNetwork(name: string, resource: string): Promise<void>
  setCustomSecret(hosts: string[], env: string, value: string, opts: { global?: boolean; sandbox?: string }): Promise<void>
  removeCustomSecret(hosts: string[], opts: { global?: boolean; sandbox?: string }): Promise<void>
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

  // Custom secret: placeholder-substitution for non-built-in services (verified in the
  // Phase 0 spike). `set-custom` has no stdin flag → value passes as argv (no shell, so
  // no history leak; brief `ps` exposure of the user's own secret on their own machine).
  function scopeArgs(opts: { global?: boolean; sandbox?: string }): string[] {
    return opts.global ? ['-g'] : opts.sandbox ? [opts.sandbox] : []
  }
  async function setCustomSecret(hosts: string[], env: string, value: string, opts: { global?: boolean; sandbox?: string }): Promise<void> {
    const hostArgs = hosts.flatMap((h) => ['--host', h])
    await runSbx(['secret', 'set-custom', ...scopeArgs(opts), ...hostArgs, '--env', env, '--value', value])
  }
  async function removeCustomSecret(hosts: string[], opts: { global?: boolean; sandbox?: string }): Promise<void> {
    const hostArgs = hosts.flatMap((h) => ['--host', h])
    await runSbx(['secret', 'rm', ...scopeArgs(opts), ...hostArgs, '-f'])
  }

  // Live port + network-policy edits on a RUNNING sandbox (Phase 0 spike-verified).
  async function listPorts(name: string): Promise<LivePort[]> {
    const res = await runSbx(['ports', name, '--json'])
    return parsePortsJson(res.stdout)
  }
  async function publishPort(name: string, port: LivePort): Promise<void> {
    await runSbx(['ports', name, '--publish', portIntentToPublishSpec({ ...port, label: '' } as PortIntent)])
  }
  async function unpublishPort(name: string, port: LivePort): Promise<void> {
    await runSbx(['ports', name, '--unpublish', portIntentToPublishSpec({ ...port, label: '' } as PortIntent)])
  }
  // Generalized policy edits: host-service = 'localhost:<port>', domain = the host.
  async function allowNetwork(name: string, resource: string): Promise<void> {
    await runSbx(['policy', 'allow', 'network', '--sandbox', name, resource])
  }
  async function removeNetwork(name: string, resource: string): Promise<void> {
    await runSbx(['policy', 'rm', 'network', '--sandbox', name, '--resource', resource])
  }

  return { runSbx, listSandboxes, createSandbox, applyPolicy, publishPorts, stopSandbox, removeSandbox, setSecret, removeSecret, setCustomSecret, removeCustomSecret, listPorts, publishPort, unpublishPort, allowNetwork, removeNetwork }
}
