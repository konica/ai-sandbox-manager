import { homedir } from 'os'
import type { DefinitionSpec, PortIntent, Tier } from '@shared/types'
import { DEFAULT_SSH } from '@shared/types'
import { toSbxName } from '@shared/names'
import { AGENT_PROFILES } from '@shared/agents'
import type { AgentId } from '@shared/agents'

export { toSbxName }

// The agent user's home inside a sandbox (verified: HOME=/home/agent).
export const SANDBOX_HOME = '/home/agent'

/** Claude Code's state directory inside a sandbox. */
export const SANDBOX_CLAUDE_DIR = `${SANDBOX_HOME}/.claude`

/** A host archive of Claude session data to restore into a sandbox being created. */
export interface SessionRestore {
  /** Absolute path to the .tgz on the host (see main/session/archive.ts). */
  archivePath: string
}

/**
 * The two steps that put an archived ~/.claude back into a sandbox: copy the tarball in,
 * then unpack it over the Claude dir.
 *
 * Each is wrapped like copyFileStep's — `{ … || echo ; }` — so a failed restore warns but
 * returns 0 and the outer `&&` chain continues: a sandbox that comes up without its history
 * is far better than one that fails to come up at all.
 *
 * Unpacking with tar (rather than copying a directory in) is what lets symlinked content
 * survive the round trip — a host-side copy has to materialise links, which fails outright
 * on Windows without elevation.
 */
export function sessionRestoreSteps(name: string, restore: SessionRestore): string[] {
  const tmp = '/tmp/claude-backup.tgz'
  const cp = shellCommand(['sbx', 'cp', restore.archivePath, `${name}:${tmp}`])
  const untar = shellCommand(['sbx', 'exec', name, 'tar', 'xzf', tmp, '-C', SANDBOX_CLAUDE_DIR])
  // `sbx cp` writes into the sandbox AS ROOT, so this tarball is root-owned. Leaving it
  // behind (a) blocked the next capture, which runs as `agent` and could not overwrite it
  // (#92), and (b) stranded a world-readable copy of the whole ~/.claude — .credentials.json
  // included — in /tmp. Its own step, AFTER the untar rather than chained onto its success,
  // so a failed unpack still cleans up.
  const rm = shellCommand(['sbx', 'exec', name, 'rm', '-f', tmp])
  return [
    `{ ${cp} || ${shellCommand(['echo', '⚠️ could not copy the session backup in'])} ; }`,
    `{ ${untar} || ${shellCommand(['echo', '⚠️ could not restore the session backup'])} ; }`,
    `{ ${rm} || true ; }`
  ]
}

/** Expand a `~`/`~/…` sandbox destination to an absolute container path; other paths pass through. */
export function expandSandboxPath(p: string): string {
  const t = p.trim()
  if (t === '~') return SANDBOX_HOME
  if (t.startsWith('~/')) return SANDBOX_HOME + t.slice(1)
  return t
}

/**
 * Expand a leading `~`/`~/…` in a HOST path to the user's home dir. `sbx cp`'s source
 * runs through our shell-quoter, which single-quotes `~` (it's not a SAFE_ARG char) so the
 * shell never expands it — `sbx cp` then fails with "lstat ~: no such file or directory".
 * Resolving `~` here, before quoting, keeps the absolute path intact through the shell.
 */
export function expandHostPath(p: string, home: string = homedir()): string {
  const t = p.trim()
  if (t === '~') return home
  if (t.startsWith('~/')) return home + t.slice(1)
  return t
}

/**
 * One best-effort `sbx cp` step: copy a host file/dir into <name> at the (expanded) dest.
 * Wrapped in `{ …; }` so a failed copy warns but returns 0 — the outer `&&` chain continues.
 */
export function copyFileStep(name: string, entry: { hostPath: string; sandboxPath: string }): string {
  const dest = `${name}:${expandSandboxPath(entry.sandboxPath)}`
  const cp = shellCommand(['sbx', 'cp', expandHostPath(entry.hostPath), dest])
  const warn = shellCommand(['echo', `⚠️ copy failed: ${entry.hostPath}`])
  return `{ ${cp} || ${warn} ; }`
}

// A conservative baseline for the "balanced" tier: package registries and
// common developer endpoints an agent typically needs, nothing broader.
export const BALANCED_BASELINE: string[] = [
  'registry.npmjs.org',
  '*.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  '*.githubusercontent.com',
  'api.anthropic.com'
]

export function resolveSandboxName(spec: DefinitionSpec): string {
  return toSbxName(spec.definition.name)
}

/** Pick the first name not already taken: `base`, then `base-2`, `base-3`, … */
export function uniqueSandboxName(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/**
 * Give every launch a distinct, unique instance name: `<base>-<hash>` where `hash` is a
 * short hex code (e.g. "proj-3323dc52"). `genHash` supplies the suffix (injected for tests);
 * regenerates on the astronomically-rare collision with an existing name.
 */
export function hashedSandboxName(base: string, existing: Iterable<string>, genHash: () => string): string {
  const taken = new Set(existing)
  let name = `${base}-${genHash()}`
  while (taken.has(name)) name = `${base}-${genHash()}`
  return name
}

export function tierToAllowlist(tier: Tier, extraDomains: string[]): string[] {
  if (tier === 'open') return ['**']
  if (tier === 'locked') return dedup(extraDomains)
  return dedup([...BALANCED_BASELINE, ...extraDomains])
}

function dedup(xs: string[]): string[] {
  return [...new Set(xs.filter((x) => x.trim().length > 0))]
}

export function specToCreateArgs(spec: DefinitionSpec, name: string = resolveSandboxName(spec), kitDir?: string): string[] {
  const primary = spec.mounts.find((m) => m.isPrimary) ?? spec.mounts[0]
  const extras = spec.mounts.filter((m) => m !== primary)
  const args = ['create', AGENT_PROFILES[spec.definition.agent].keyword, primary.hostPath]
  for (const m of extras) args.push(m.mode === 'clone' ? `${m.hostPath}:ro` : m.hostPath)
  args.push('--name', name)
  if (spec.definition.baseImage.trim().length > 0) args.push('--template', spec.definition.baseImage)
  if (kitDir) args.push('--kit', kitDir)
  const { cpus, memory } = spec.definition
  if (typeof cpus === 'number' && cpus >= 1) args.push('--cpus', String(cpus))
  if (memory && memory.trim().length > 0) args.push('-m', memory.trim())
  return args
}

// sbx port spec: [[HOST_IP:]HOST_PORT:]SANDBOX_PORT[/PROTOCOL]. Omit the host port for
// an ephemeral (OS-allocated) host port; PROTOCOL is one of tcp/tcp4/tcp6.
export function portIntentToPublishSpec(p: PortIntent): string {
  const host = p.hostPort !== null ? `${p.hostPort}:` : ''
  return `${host}${p.containerPort}/${p.protocol}`
}

/**
 * The ports to publish for a launch. First instance of a definition → all ports.
 * A subsequent instance → only ephemeral (OS-allocated) ports, since fixed host
 * ports would collide with the sibling that already claimed them. Corrected fixed
 * ports are added later from the instance's Ports tab.
 */
export function portsForLaunch(ports: PortIntent[], isSubsequent: boolean): PortIntent[] {
  return isSubsequent ? ports.filter((p) => p.hostPort === null) : ports
}

/** `--static-mcp a,b` argv for a static MCP binding's (already-resolved) server names; empty ⇒ no flag. */
export function staticMcpArgs(servers: string[]): string[] {
  return servers.length > 0 ? ['--static-mcp', servers.join(',')] : []
}

/** Single-quote a string for safe embedding in a POSIX shell command. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// Attach reconnects to an existing sandbox and resumes the agent's most recent
// session (Claude Code `--continue`), passed through `sbx run`'s `--` separator.
// resumeArgs are routed through shellCommand like every other arg path in this file,
// so a future profile with a space/metacharacter in its resumeArgs is quoted, not
// silently mis-parsed.
export function agentAttachCommand(name: string, agent: AgentId, capturePort?: number): string {
  // While capturing, launch through `sbx exec` instead of `sbx run`. `sbx run` has no --env
  // flag, so the agent would inherit the container's stock proxy and bypass Burp entirely —
  // the whole point of enabling capture. `sbx exec` accepts --env, starts the sandbox if it
  // is stopped, and lands in the same workspace directory, and `--continue` was verified
  // against a live sandbox to resume the *same* session there rather than starting a fresh
  // one. With capture off this returns the original `sbx run` form untouched.
  if (capturePort === undefined) {
    return `sbx run --name ${shellQuote(name)} -- ${shellCommand(AGENT_PROFILES[agent].resumeArgs)}`
  }
  const profile = AGENT_PROFILES[agent]
  return `sbx exec -it ${captureEnvFlags(capturePort)}${shellQuote(name)} ${profile.keyword} ${shellCommand(profile.resumeArgs)}`
}

/** Destinations that stay direct while capturing — mirrors the capture profile script.
 * Matched against the DESTINATION, never the proxy address, so keeping loopback here
 * leaves sandbox-local services direct without bypassing the capture relay. */
const CAPTURE_NO_PROXY = 'localhost,127.0.0.1,::1,gateway.docker.internal'

/**
 * The command that opens a shell inside a running sandbox.
 *
 * `capturePort` is the in-sandbox capture relay port, passed only while traffic capture is
 * actively running for THIS sandbox. It has to be injected here because `sbx exec` starts a
 * **non-login** bash, which never sources `/etc/profile.d` — so the capture profile script
 * cannot reach it, and the shell would silently keep the sandbox's stock proxy and bypass
 * Burp entirely. Omitting it leaves the command byte-identical to the pre-capture form, so
 * nothing changes for sandboxes that are not being captured.
 */
/**
 * `sbx exec --env` flags routing a process at the in-sandbox capture relay, or '' when not
 * capturing. Shared by the shell and the agent launch so the two can never drift — a shell
 * that is captured while the agent is not would be a confusing half-working state.
 *
 * Six repeated `-e` flags look like something an env file would tidy up. Two things to know
 * before trying that, both measured against sbx v0.38.0:
 *
 * - `sbx exec --env-file` is a NO-OP. It is listed in `--help`, but a variable set only in
 *   the file arrives unset in the sandbox, and pointing the flag at a nonexistent path does
 *   not even error. It cannot carry these values today.
 * - The lighter alternative is a login shell (`bash -l`), which picks these up from
 *   /etc/profile.d/burp-proxy.sh with no flags at all — and degrades better, because that
 *   script checks the relay is actually listening. A copied `-e` command whose port has since
 *   died leaves the shell with no egress at all (measured: HTTP 000); a login shell falls
 *   back to the stock sbx proxy (HTTP 200). Deliberately deferred, not overlooked.
 */
function captureEnvFlags(capturePort?: number): string {
  if (capturePort === undefined) return ''
  return [
    `http_proxy=http://127.0.0.1:${capturePort}`,
    `https_proxy=http://127.0.0.1:${capturePort}`,
    `HTTP_PROXY=http://127.0.0.1:${capturePort}`,
    `HTTPS_PROXY=http://127.0.0.1:${capturePort}`,
    `no_proxy=${CAPTURE_NO_PROXY}`,
    `NO_PROXY=${CAPTURE_NO_PROXY}`
  ].map((e) => `-e ${e} `).join('')
}

export function hostShellCommand(name: string, capturePort?: number): string {
  return `sbx exec -it ${captureEnvFlags(capturePort)}${shellQuote(name)} bash`
}

// Ephemeral Claude session for a host-side OAuth `/login`. Chained with `;` so the
// throwaway sandbox is removed after the user exits Claude; the global token persists.
export function loginCommand(workdir: string, name: string, kitDir: string): string {
  const run = shellCommand(['sbx', 'run', 'claude', workdir, '--name', name, '--kit', kitDir])
  const rm = shellCommand(['sbx', 'rm', name, '--force'])
  return `${run} ; ${rm}`
}

// Args matching this are safe to pass unquoted in a shell command; anything
// else (spaces, shell metacharacters like * , etc.) gets single-quoted.
const SAFE_ARG = /^[A-Za-z0-9_./:=+-]+$/

/** Render an argv as a single POSIX shell command string, quoting only what needs it. */
export function shellCommand(argv: string[]): string {
  return argv.map((a) => (SAFE_ARG.test(a) ? a : shellQuote(a))).join(' ')
}

/**
 * The full interactive launch command run in a native terminal:
 *   create (provision) → apply network tier → publish ports → run (attach agent).
 * Chained with `&&` so a failed step stops the sequence and stays visible.
 */
export function launchCommand(spec: DefinitionSpec, name: string = resolveSandboxName(spec), sessionName?: string, kitDir?: string, ports: PortIntent[] = spec.ports, mcpServers: string[] = [], restore?: SessionRestore): string {
  const steps: string[] = [shellCommand(['sbx', ...specToCreateArgs(spec, name, kitDir)])]
  if (!kitDir) {
    // A generated kit owns `allowedDomains`; only apply standalone policy without one.
    const resources = tierToAllowlist(spec.definition.tier, spec.domains)
    if (resources.length > 0) {
      steps.push(shellCommand(['sbx', 'policy', 'allow', 'network', '--sandbox', name, resources.join(',')]))
    }
  }
  for (const p of ports) {
    steps.push(shellCommand(['sbx', 'ports', name, '--publish', portIntentToPublishSpec(p)]))
  }
  // `sbx run` attaches the agent; args after `--` go to the agent CLI — the agent's own
  // session view on a fresh launch. The static MCP flag must land before that separator,
  // alongside sbx's own flags.
  const runArgs = ['sbx', 'run', '--name', name, ...staticMcpArgs(mcpServers)]
  // A session name still wins while the field exists; without one the agent's own session
  // view is opened instead (claude: `agents`). Only add `--` when something follows it — a
  // bare trailing separator dangles and would swallow the next token.
  const agentArgs = sessionName && sessionName.trim()
    ? AGENT_PROFILES[spec.definition.agent].sessionNameArgs(sessionName.trim())
    : AGENT_PROFILES[spec.definition.agent].launchArgs
  if (agentArgs.length > 0) runArgs.push('--', ...agentArgs)
  steps.push(shellCommand(runArgs))

  // SSH: when the agent is forwarded, set up host-key trust (and optionally commit
  // signing) inside the sandbox right after create. Forward opt-out strips
  // SSH_AUTH_SOCK from the launching shell so sbx doesn't forward the agent.
  const ssh = spec.ssh ?? DEFAULT_SSH
  const postCreate: string[] = []
  if (ssh.forwardAgent) {
    postCreate.push(sshHostKeySetupCommand(name))
    if (ssh.commitSigning) postCreate.push(commitSigningExecCommand(name))
  }
  for (const entry of spec.copyFiles ?? []) postCreate.push(copyFileStep(name, entry))
  // Session restore joins the postCreate steps so it runs after `sbx create` and before
  // `sbx run` — the transcripts must be on disk before the agent process starts.
  if (restore) postCreate.push(...sessionRestoreSteps(name, restore))
  if (postCreate.length) steps.splice(1, 0, ...postCreate)
  const chain = steps.join(' && ')
  return ssh.forwardAgent ? chain : `unset SSH_AUTH_SOCK ; ${chain}`
}

// Make Git-over-SSH work non-interactively in the sandbox. The forwarded agent carries
// the private key, but the sandbox has no known_hosts of its own — so a first push hits
// "Host key verification failed" (no TTY/askpass to accept the key). Create ~/.ssh and set
// StrictHostKeyChecking=accept-new: first-seen host keys are trusted, a later CHANGED key is
// still rejected. Single-quoted so it runs inside the sandbox; idempotent via the grep guard.
export function sshHostKeySetupCommand(name: string): string {
  return `sbx exec ${name} bash -lc 'mkdir -p ~/.ssh && chmod 700 ~/.ssh; grep -qs "StrictHostKeyChecking accept-new" ~/.ssh/config || printf "Host *\\n\\tStrictHostKeyChecking accept-new\\n" >> ~/.ssh/config; chmod 600 ~/.ssh/config'`
}

// SSH-based commit signing setup, run INSIDE the sandbox against the forwarded agent.
// The body is single-quoted so `$( )` executes in the sandbox, not on the host.
export function commitSigningExecCommand(name: string): string {
  return `sbx exec ${name} bash -lc 'git config --global gpg.format ssh && git config --global user.signingkey "key::$(ssh-add -L | head -n 1)"'`
}

// `sbx mcp auth` blocks on a browser-based OAuth flow (Phase 0 spike), so it runs in a
// native terminal like login/attach rather than a captured child process.
export function mcpAuthCommand(name: string): string {
  return shellCommand(['sbx', 'mcp', 'auth', name])
}
