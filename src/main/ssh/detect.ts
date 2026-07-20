/** True when the host login env has a usable SSH agent socket. */
export function sshAuthSockPresent(env: Record<string, string | undefined>): boolean {
  return typeof env.SSH_AUTH_SOCK === 'string' && env.SSH_AUTH_SOCK.length > 0
}
