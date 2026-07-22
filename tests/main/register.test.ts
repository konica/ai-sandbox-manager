import { describe, it, expect } from 'vitest'
import { credFingerprint } from '../../src/main/creds/register'
import type { CredentialRef } from '../../src/shared/types'

const custom = (envVar: string, domains: string[]): CredentialRef => ({ kind: 'custom', id: envVar, label: envVar, envVar, domains, store: 'encrypted' })
const service = (serviceId: string, envVar: string): CredentialRef => ({ kind: 'service', serviceId, envVar, store: 'sbx' })

describe('credFingerprint', () => {
  it('is order-independent', () => {
    const a = [custom('A', ['x.com']), service('anthropic', 'ANTHROPIC_API_KEY')]
    const b = [service('anthropic', 'ANTHROPIC_API_KEY'), custom('A', ['x.com'])]
    expect(credFingerprint(a)).toBe(credFingerprint(b))
  })
  it('changes when a credential is added or removed', () => {
    const before = [custom('A', ['x.com'])]
    const after = [custom('A', ['x.com']), custom('B', ['y.com'])]
    expect(credFingerprint(after)).not.toBe(credFingerprint(before))
  })
  it('is stable across domain ordering', () => {
    expect(credFingerprint([custom('A', ['a.com', 'b.com'])])).toBe(credFingerprint([custom('A', ['b.com', 'a.com'])]))
  })
  it('empty set is a stable empty fingerprint', () => {
    expect(credFingerprint([])).toBe('')
  })
})
