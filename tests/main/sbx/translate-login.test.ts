import { describe, it, expect } from 'vitest'
import { loginCommand } from '../../../src/main/sbx/translate'

describe('loginCommand', () => {
  it('runs claude in the workdir with the login kit, then removes the ephemeral sandbox', () => {
    const cmd = loginCommand('/tmp/sbx-login', 'sbx-oauth-login', '/tmp/sbx-login/.kit')
    expect(cmd).toContain('sbx run claude /tmp/sbx-login --name sbx-oauth-login --kit /tmp/sbx-login/.kit')
    expect(cmd).toMatch(/sbx rm sbx-oauth-login (--force|-f)/)
    expect(cmd).not.toContain('secret') // no credential ever on the command line
  })
})
