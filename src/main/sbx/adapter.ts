import { spawn } from 'child_process'
import type { SbxInstance, DefinitionSpec, PortIntent, Tier, LivePort, PolicySummary } from '@shared/types'
import type { McpServer, McpServerDetail, McpAuthState, McpAddInput } from '@shared/mcp'
import { SbxError, classifySbxError } from '@shared/errors'
import { isValidCredHost } from '@shared/host'
import { parseSbxLsJson, parseSbxLsText, parsePortsJson } from './parse'
import { parsePolicyLog } from './policy-log'
import { parseDiagnoseAuth, type AuthCheck } from './diagnose'
import { specToCreateArgs, tierToAllowlist, portIntentToPublishSpec } from './translate'
import type { Logger } from '../log'
import { parseListOutput, type ListResult } from '@shared/copy'
import { listDirScript, statScript, existsScript, parseStat, parseExists } from './fs-probe'
import {
  parseMcpLsJson,
  parseMcpLsText,
  parseMcpInspectJson,
  parseMcpInspectText,
  parseMcpAuthStatusJson,
  parseMcpAuthStatusText
} from './mcp-parse'

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
  listGlobalSecretsRaw(): Promise<string>
  /** Raw `sbx secret ls <name>` stdout (one sandbox) — parsed to recover custom secrets' dynamic placeholders. */
  listInstanceSecretsRaw(name: string): Promise<string>
  listPorts(name: string): Promise<LivePort[]>
  publishPort(name: string, port: LivePort): Promise<void>
  unpublishPort(name: string, port: LivePort): Promise<void>
  allowNetwork(name: string, resource: string): Promise<void>
  removeNetwork(name: string, resource: string): Promise<void>
  policyLog(name: string): Promise<PolicySummary>
  setCustomSecret(hosts: string[], env: string, value: string, opts: { global?: boolean; sandbox?: string }): Promise<void>
  removeCustomSecret(hosts: string[], opts: { global?: boolean; sandbox?: string }): Promise<void>
  setRegistrySecret(host: string, username: string | undefined, token: string, opts: { global?: boolean; sandbox?: string }): Promise<void>
  removeRegistrySecret(host: string, opts: { global?: boolean; sandbox?: string }): Promise<void>
  /** Docker sign-in / governance registration state (via `sbx diagnose`). 'unknown' never blocks. */
  checkDockerAuth(): Promise<AuthCheck>
  /** Run `sbx kit validate <dir>`; non-throwing. Missing sbx → resolves, never rejects. */
  validateKit(dir: string): Promise<{ code: number; out: string; ran: boolean }>
  /** Run a bash login-shell script inside a running sandbox: `sbx exec <name> bash -lc <script>`. Throws SbxError on non-zero exit. */
  execScript(name: string, script: string): Promise<void>
  /** Like execScript but returns the exec's stdout: `sbx exec <name> bash -lc <script>`. Throws on non-zero exit. */
  execCapture(name: string, script: string): Promise<string>
  /** List a directory inside a running sandbox (`ls -1Ap` in a login shell). Never throws on an
   * unreadable dir — returns `{ ok:false }`; only exec/spawn failures reject. */
  listSandboxDir(name: string, path: string): Promise<ListResult>
  /** Classify a sandbox path as dir/file/missing. */
  probeSandboxPath(name: string, path: string): Promise<'dir' | 'file' | 'missing'>
  /** For each path, whether it exists inside the sandbox (order-preserving). Empty → []. */
  sandboxTargetsExist(name: string, paths: string[]): Promise<boolean[]>
  /** `sbx cp <hostSrc> <name>:<sandboxDest>`. Throws SbxError on failure. */
  copyToSandbox(name: string, hostSrc: string, sandboxDest: string): Promise<void>
  /** `sbx cp <name>:<sandboxSrc> <hostDest>`. Throws SbxError on failure. */
  copyFromSandbox(name: string, sandboxSrc: string, hostDest: string): Promise<void>
  /** Host-registered MCP servers (`sbx mcp ls`). */
  listMcpServers(): Promise<McpServer[]>
  /** Detail for one registered MCP server (`sbx mcp inspect <name>`). */
  inspectMcpServer(name: string): Promise<McpServerDetail>
  /** Register a new MCP server (`sbx mcp add`); argv shape depends on `input.transport`. */
  addMcpServer(input: McpAddInput): Promise<void>
  /** Unregister an MCP server (`sbx mcp rm <name>`). */
  removeMcpServer(name: string): Promise<void>
  /** Credential status for one MCP server (`sbx mcp auth status <name> --format json`). Never throws on unparseable output — resolves 'unknown'. */
  mcpAuthStatus(name: string): Promise<McpAuthState>
  /** Set an MCP server's confidential-client secret via the stdin secret path (no value on argv). */
  setMcpClientSecret(name: string, value: string): Promise<void>
  /** Clear an MCP server's confidential-client secret. */
  removeMcpAuth(name: string): Promise<void>
  /** Attach a registered MCP server to a running sandbox (`sbx mcp load`). */
  loadMcpServer(sandboxName: string, serverName: string): Promise<void>
  /** Whether the installed `sbx` CLI exposes `mcp` subcommands. Never throws — resolves false on any spawn/parse failure. */
  mcpSupported(): Promise<boolean>
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

  // Raw `sbx secret ls -g` stdout for host-side auth detection (parsed by src/main/auth).
  async function listGlobalSecretsRaw(): Promise<string> {
    const res = await runSbx(['secret', 'ls', '-g'])
    return res.stdout
  }

  // Raw `sbx secret ls <name>` stdout (one sandbox) — parsed for custom secrets' dynamic placeholders.
  async function listInstanceSecretsRaw(name: string): Promise<string> {
    const res = await runSbx(['secret', 'ls', name])
    return res.stdout
  }

  // Custom secret: placeholder-substitution for non-built-in services (verified in the
  // Phase 0 spike). `set-custom` has no stdin flag → value passes as argv (no shell, so
  // no history leak; brief `ps` exposure of the user's own secret on their own machine).
  function scopeArgs(opts: { global?: boolean; sandbox?: string }): string[] {
    return opts.global ? ['-g'] : opts.sandbox ? [opts.sandbox] : []
  }
  // sbx refuses a target carrying a scheme or port ("expected host or IP without scheme/port").
  // Fail here with a message that says what to do instead, rather than passing it down and
  // surfacing the CLI's wording — the host is used verbatim, never rewritten.
  function hostArgsFor(hosts: string[]): string[] {
    return hosts.flatMap((h) => {
      const host = h.trim()
      if (!isValidCredHost(host)) throw new SbxError('generic', `"${h}" is not a usable target host. Use a bare host, IP, or wildcard such as api.example.com or *.example.com — no scheme, port, or path.`)
      return ['--host', host]
    })
  }
  async function setCustomSecret(hosts: string[], env: string, value: string, opts: { global?: boolean; sandbox?: string }): Promise<void> {
    const hostArgs = hostArgsFor(hosts)
    await runSbx(['secret', 'set-custom', ...scopeArgs(opts), ...hostArgs, '--env', env, '--value', value])
  }
  async function removeCustomSecret(hosts: string[], opts: { global?: boolean; sandbox?: string }): Promise<void> {
    const hostArgs = hostArgsFor(hosts)
    await runSbx(['secret', 'rm', ...scopeArgs(opts), ...hostArgs, '-f'])
  }

  // Registry pull credential (Phase 0 spike). Token via --password-stdin (never on argv);
  // scope decides where it applies (host-only / global / sandbox). Overwrite needs -f — the
  // spike showed stdin re-writes still error without it — so always pass -f for idempotent relaunch.
  async function setRegistrySecret(host: string, username: string | undefined, token: string, opts: { global?: boolean; sandbox?: string }): Promise<void> {
    const userArgs = username && username.trim() ? ['--username', username.trim()] : []
    await runSbx(['secret', 'set', ...scopeArgs(opts), '-f', '--registry', host, ...userArgs, '--password-stdin'], { stdin: token })
  }
  async function removeRegistrySecret(host: string, opts: { global?: boolean; sandbox?: string }): Promise<void> {
    await runSbx(['secret', 'rm', ...scopeArgs(opts), '--registry', host, '-f'])
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
  async function policyLog(name: string): Promise<PolicySummary> {
    const res = await runSbx(['policy', 'log', name, '--json'])
    return parsePolicyLog(res.stdout)
  }
  async function checkDockerAuth(): Promise<AuthCheck> {
    // Bypass runSbx's throw-on-nonzero: diagnose is a report, not an action, and
    // may exit non-zero while still emitting a usable JSON body. A spawn failure
    // (not installed, daemon unreachable) → 'unknown', which never blocks a launch.
    logger?.command(['diagnose', '-o', 'json'])
    try {
      const res = await spawnFn('sbx', ['diagnose', '-o', 'json'], {})
      return parseDiagnoseAuth(res.stdout)
    } catch (e) {
      logger?.error(`sbx diagnose failed: ${(e as Error).message}`)
      return 'unknown'
    }
  }

  // No -d (detached): the exec must be synchronous so a failing script surfaces a non-zero exit
  // (→ runSbx throws), which callers rely on to NOT clear credential drift.
  async function execScript(name: string, script: string): Promise<void> {
    await runSbx(['exec', name, 'bash', '-lc', script])
  }

  async function execCapture(name: string, script: string): Promise<string> {
    const res = await runSbx(['exec', name, 'bash', '-lc', script])
    return res.stdout
  }

  async function listSandboxDir(name: string, path: string): Promise<ListResult> {
    const out = await execCapture(name, listDirScript(path))
    return parseListOutput(out)
  }
  async function probeSandboxPath(name: string, path: string): Promise<'dir' | 'file' | 'missing'> {
    return parseStat(await execCapture(name, statScript(path)))
  }
  async function sandboxTargetsExist(name: string, paths: string[]): Promise<boolean[]> {
    if (paths.length === 0) return []
    return parseExists(await execCapture(name, existsScript(paths)), paths.length)
  }
  async function copyToSandbox(name: string, hostSrc: string, sandboxDest: string): Promise<void> {
    await runSbx(['cp', hostSrc, `${name}:${sandboxDest}`])
  }
  async function copyFromSandbox(name: string, sandboxSrc: string, hostDest: string): Promise<void> {
    await runSbx(['cp', `${name}:${sandboxSrc}`, hostDest])
  }

  async function validateKit(dir: string): Promise<{ code: number; out: string; ran: boolean }> {
    logger?.command(['kit', 'validate', dir])
    try {
      const res = await spawnFn('sbx', ['kit', 'validate', dir], {})
      return { code: res.code, out: (res.stdout + res.stderr).trim(), ran: true }
    } catch (e) {
      logger?.error(`sbx kit validate unavailable: ${(e as Error).message}`)
      return { code: -1, out: (e as Error).message, ran: false }
    }
  }

  // MCP Gateway (Phase 0 spike-verified against sbx v0.38.0): `mcp ls`/`mcp inspect` are
  // text-only today, but requested with --json first (like listSandboxes) so a future sbx
  // that adds JSON support is picked up without an adapter change.
  //
  // Today's sbx doesn't merely ignore the unknown flag — it exits 1 with
  // "ERROR: unknown flag: --json", so the run has to be retried flagless before parsing.
  // If the flagless retry fails too, that's a real failure and its error propagates.
  async function runSbxPreferJson(baseArgs: string[]): Promise<SbxResult> {
    try {
      return await runSbx([...baseArgs, '--json'])
    } catch {
      return await runSbx(baseArgs)
    }
  }

  async function listMcpServers(): Promise<McpServer[]> {
    const res = await runSbxPreferJson(['mcp', 'ls'])
    try {
      return parseMcpLsJson(res.stdout)
    } catch {
      return parseMcpLsText(res.stdout)
    }
  }

  async function inspectMcpServer(name: string): Promise<McpServerDetail> {
    const res = await runSbxPreferJson(['mcp', 'inspect', name])
    try {
      return parseMcpInspectJson(res.stdout, name)
    } catch {
      return parseMcpInspectText(res.stdout, name)
    }
  }

  function mcpAddArgs(input: McpAddInput): string[] {
    const scopeArgs = input.scopes.flatMap((s) => ['--scope', s])
    if (input.transport === 'remote') {
      // A server whose discovered OAuth metadata has no registration_endpoint can't do
      // Dynamic Client Registration, so sbx rejects the add unless --client-id names a
      // pre-registered client. The client *secret* has no flag by design — it goes to the
      // secret store via setMcpClientSecret().
      const clientIdArgs = input.clientId ? ['--client-id', input.clientId] : []
      return ['mcp', 'add', input.name, '--url', input.url, ...clientIdArgs, ...scopeArgs, ...(input.skipAuth ? ['--skip_auth'] : [])]
    }
    if (input.transport === 'local') {
      return ['mcp', 'add', input.name, '--local', '--url', input.metadataUrl, ...scopeArgs]
    }
    const argArgs = input.args.flatMap((a) => ['--args', a])
    return ['mcp', 'add', input.name, '--command', input.command, ...argArgs, ...scopeArgs]
  }

  async function addMcpServer(input: McpAddInput): Promise<void> {
    await runSbx(mcpAddArgs(input))
  }

  async function removeMcpServer(name: string): Promise<void> {
    await runSbx(['mcp', 'rm', name])
  }

  async function mcpAuthStatus(name: string): Promise<McpAuthState> {
    const res = await runSbx(['mcp', 'auth', 'status', name, '--format', 'json'])
    const entries = parseMcpAuthStatusJson(res.stdout)
    const found = entries.find((e) => e.name === name)
    if (found) return found.state
    const textEntries = parseMcpAuthStatusText(res.stdout)
    return textEntries.find((e) => e.name === name)?.state ?? 'unknown'
  }

  // Confidential-client secret: no `--client-secret` flag exists (Phase 0 spike), so this
  // reuses the same stdin secret path as any other service — never on argv.
  async function setMcpClientSecret(name: string, value: string): Promise<void> {
    await setSecret(`mcp:${name}.client_secret`, value, { global: true })
  }

  async function removeMcpAuth(name: string): Promise<void> {
    await removeSecret(`mcp:${name}.client_secret`, { global: true })
  }

  async function loadMcpServer(sandboxName: string, serverName: string): Promise<void> {
    await runSbx(['mcp', 'load', serverName, '--sandbox', sandboxName])
  }

  // Exit codes are unreliable for MCP-absence detection (every unsupported-command
  // invocation on a pre-MCP sbx returns exit 0, per the Phase 0 spike). Instead parse the
  // `sbx --help` command list for an `mcp` entry; any spawn/parse failure resolves false.
  async function mcpSupported(): Promise<boolean> {
    try {
      const res = await spawnFn('sbx', ['--help'], {})
      return /^\s*mcp\b/m.test(res.stdout + res.stderr)
    } catch (e) {
      logger?.error(`sbx --help failed while probing mcp support: ${(e as Error).message}`)
      return false
    }
  }

  return { runSbx, listSandboxes, createSandbox, applyPolicy, publishPorts, stopSandbox, removeSandbox, setSecret, removeSecret, listGlobalSecretsRaw, listInstanceSecretsRaw, setCustomSecret, removeCustomSecret, setRegistrySecret, removeRegistrySecret, listPorts, publishPort, unpublishPort, allowNetwork, removeNetwork, policyLog, checkDockerAuth, execScript, execCapture, validateKit, listSandboxDir, probeSandboxPath, sandboxTargetsExist, copyToSandbox, copyFromSandbox, listMcpServers, inspectMcpServer, addMcpServer, removeMcpServer, mcpAuthStatus, setMcpClientSecret, removeMcpAuth, loadMcpServer, mcpSupported }
}
