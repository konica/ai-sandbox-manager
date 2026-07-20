import { describe, it, expect, vi } from 'vitest'
import { claudeAuthStatus, claudeSignOut, hasAnthropicCredential, needsAuthNudge } from '../../../src/main/auth/manager'
import type { DefinitionSpec } from '../../../src/shared/types'

const spec = (creds: DefinitionSpec['credentials']): DefinitionSpec => ({
  definition: { id: 'd', name: 'n', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: creds
})

describe('auth manager', () => {
  it('claudeAuthStatus maps parser output', async () => {
    const s = await claudeAuthStatus({ listGlobalSecretsRaw: async () => '(global)   service   anthropic   (oauth configured)' })
    expect(s.anthropic).toBe('oauth')
  })
  it('claudeAuthStatus fails open to none on adapter error', async () => {
    const s = await claudeAuthStatus({ listGlobalSecretsRaw: async () => { throw new Error('boom') } })
    expect(s.anthropic).toBe('none')
  })
  it('claudeSignOut removes the global anthropic secret', async () => {
    const removeSecret = vi.fn(async () => {})
    await claudeSignOut({ removeSecret })
    expect(removeSecret).toHaveBeenCalledWith('anthropic', { global: true })
  })
  it('hasAnthropicCredential is true when a service anthropic cred exists', () => {
    expect(hasAnthropicCredential(spec([{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }]))).toBe(true)
    expect(hasAnthropicCredential(spec([]))).toBe(false)
  })
  it('needsAuthNudge only when none AND no definition anthropic cred', () => {
    expect(needsAuthNudge('none', spec([]))).toBe(true)
    expect(needsAuthNudge('oauth', spec([]))).toBe(false)
    expect(needsAuthNudge('apikey', spec([]))).toBe(false)
    expect(needsAuthNudge('none', spec([{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }]))).toBe(false)
  })
})
