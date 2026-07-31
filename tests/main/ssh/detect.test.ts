import { describe, it, expect } from 'vitest'
import { sshAgentPresent, sshAuthSockPresent } from '../../../src/main/ssh/detect'

describe('sshAuthSockPresent', () => {
  it('true when SSH_AUTH_SOCK is a non-empty string', () => {
    expect(sshAuthSockPresent({ SSH_AUTH_SOCK: '/tmp/agent.sock' })).toBe(true)
  })
  it('false when unset or empty', () => {
    expect(sshAuthSockPresent({})).toBe(false)
    expect(sshAuthSockPresent({ SSH_AUTH_SOCK: '' })).toBe(false)
    expect(sshAuthSockPresent({ SSH_AUTH_SOCK: undefined })).toBe(false)
  })
})

// Windows' OpenSSH agent speaks a named pipe (\\.\pipe\openssh-ssh-agent) and never sets
// SSH_AUTH_SOCK, so the POSIX env check above reports "no agent detected" on Windows no
// matter how healthy the agent is — a false negative by construction. `ssh-add -l` is the
// transport-independent probe: exit 0 = keys loaded, 1 = agent up but empty, 2 = no agent.
describe('sshAgentPresent', () => {
  it('detects a reachable Windows agent even though SSH_AUTH_SOCK is unset', () => {
    expect(sshAgentPresent({ platform: 'win32', env: {}, runSshAdd: () => ({ status: 0 }) })).toBe(true)
  })
  it('counts "agent up, no identities" (exit 1) as present — the agent is there to add keys to', () => {
    expect(sshAgentPresent({ platform: 'win32', env: {}, runSshAdd: () => ({ status: 1 }) })).toBe(true)
  })
  it('reports absent when no agent is reachable (exit 2)', () => {
    expect(sshAgentPresent({ platform: 'win32', env: {}, runSshAdd: () => ({ status: 2 }) })).toBe(false)
  })
  it('reports absent when ssh-add is missing or cannot be spawned', () => {
    expect(sshAgentPresent({ platform: 'win32', env: {}, runSshAdd: () => { throw new Error('ENOENT') } })).toBe(false)
    expect(sshAgentPresent({ platform: 'win32', env: {}, runSshAdd: () => ({ status: null }) })).toBe(false)
  })
  it('keeps the login-env check on macOS/Linux and never spawns a probe there', () => {
    let spawned = false
    const runSshAdd = (): { status: number | null } => { spawned = true; return { status: 0 } }
    expect(sshAgentPresent({ platform: 'darwin', env: { SSH_AUTH_SOCK: '/tmp/s.sock' }, runSshAdd })).toBe(true)
    expect(sshAgentPresent({ platform: 'linux', env: {}, runSshAdd })).toBe(false)
    expect(spawned).toBe(false)
  })
})
