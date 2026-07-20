import { describe, it, expect } from 'vitest'
import { sshAuthSockPresent } from '../../../src/main/ssh/detect'

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
