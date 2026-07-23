import type { DefinitionSpec, PortIntent, Tier } from '@shared/types'
import { DEFAULT_SSH } from '@shared/types'
import { toSbxName } from '@shared/names'

export { toSbxName }

export const AGENT_KEYWORD = 'claude'

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
  const args = ['create', AGENT_KEYWORD, primary.hostPath]
  for (const m of extras) args.push(m.mode === 'clone' ? `${m.hostPath}:ro` : m.hostPath)
  args.push('--name', name)
  if (spec.definition.baseImage.trim().length > 0) args.push('--template', spec.definition.baseImage)
  if (kitDir) args.push('--kit', kitDir)
  return args
}

// sbx port spec: [[HOST_IP:]HOST_PORT:]SANDBOX_PORT[/PROTOCOL]. Omit the host port for
// an ephemeral (OS-allocated) host port; PROTOCOL is one of tcp/tcp4/tcp6.
export function portIntentToPublishSpec(p: PortIntent): string {
  const host = p.hostPort !== null ? `${p.hostPort}:` : ''
  return `${host}${p.containerPort}/${p.protocol}`
}

/** Single-quote a string for safe embedding in a POSIX shell command. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// Attach reconnects to an existing sandbox and resumes the agent's most recent
// session (Claude Code `--continue`), passed through `sbx run`'s `--` separator.
export function agentAttachCommand(name: string): string {
  return `sbx run --name ${shellQuote(name)} -- --continue`
}

export function hostShellCommand(name: string): string {
  return `sbx exec -it ${shellQuote(name)} bash`
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
export function launchCommand(spec: DefinitionSpec, name: string = resolveSandboxName(spec), sessionName?: string, kitDir?: string): string {
  const steps: string[] = [shellCommand(['sbx', ...specToCreateArgs(spec, name, kitDir)])]
  if (!kitDir) {
    // A generated kit owns `allowedDomains`; only apply standalone policy without one.
    const resources = tierToAllowlist(spec.definition.tier, spec.domains)
    if (resources.length > 0) {
      steps.push(shellCommand(['sbx', 'policy', 'allow', 'network', '--sandbox', name, resources.join(',')]))
    }
  }
  for (const p of spec.ports) {
    steps.push(shellCommand(['sbx', 'ports', name, '--publish', portIntentToPublishSpec(p)]))
  }
  // `sbx run` attaches the agent; args after `--` go to Claude Code. A session
  // name maps to `claude --name`, its display name for this new conversation.
  const runArgs = ['sbx', 'run', '--name', name]
  if (sessionName && sessionName.trim()) runArgs.push('--', '--name', sessionName.trim())
  steps.push(shellCommand(runArgs))

  // SSH: when the agent is forwarded, set up host-key trust (and optionally commit
  // signing) inside the sandbox right after create. Forward opt-out strips
  // SSH_AUTH_SOCK from the launching shell so sbx doesn't forward the agent.
  const ssh = spec.ssh ?? DEFAULT_SSH
  if (ssh.forwardAgent) {
    const post = [sshHostKeySetupCommand(name)]
    if (ssh.commitSigning) post.push(commitSigningExecCommand(name))
    steps.splice(1, 0, ...post)
  }
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
