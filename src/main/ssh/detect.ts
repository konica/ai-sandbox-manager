import { spawnSync } from 'node:child_process'

/** True when the host login env has a usable SSH agent socket. */
export function sshAuthSockPresent(env: Record<string, string | undefined>): boolean {
  return typeof env.SSH_AUTH_SOCK === 'string' && env.SSH_AUTH_SOCK.length > 0
}

/**
 * `ssh-add -l` exit codes, the transport-independent way to ask "is an agent reachable?":
 * 0 = agent up with keys, 1 = agent up but holding none, 2 = could not connect to an agent.
 * Both 0 and 1 mean the agent exists; only 2 (and a failed spawn) mean it does not.
 */
const SSH_ADD_NO_AGENT = 2

function probeSshAdd(): { status: number | null } {
  return spawnSync('ssh-add', ['-l'], { stdio: 'ignore', windowsHide: true })
}

/**
 * Whether the host has an SSH agent, branching on platform because the two OS families
 * expose an agent completely differently:
 *
 * - macOS/Linux: the agent is addressed by the SSH_AUTH_SOCK env var, which is also the
 *   exact lever `launchCommand` uses to opt out of forwarding — so reading the login env
 *   answers the question with no subprocess.
 * - Windows: OpenSSH ships the agent as a service reached over the named pipe
 *   \\.\pipe\openssh-ssh-agent and never sets SSH_AUTH_SOCK. Checking the env there is a
 *   guaranteed false negative regardless of host state, so probe the agent directly.
 */
export function sshAgentPresent(opts: {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  runSshAdd?: () => { status: number | null }
} = {}): boolean {
  const platform = opts.platform ?? process.platform
  if (platform !== 'win32') return sshAuthSockPresent(opts.env ?? {})
  try {
    const { status } = (opts.runSshAdd ?? probeSshAdd)()
    return status !== null && status !== SSH_ADD_NO_AGENT
  } catch {
    // ssh-add absent (no OpenSSH client installed) — nothing to forward.
    return false
  }
}
