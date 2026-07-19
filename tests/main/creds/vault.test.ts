import { describe, it, expect } from 'vitest'
import { createMemoryVault } from '../../../src/main/creds/vault'

describe('SecretVault (memory)', () => {
  it('round-trips a value', () => {
    const v = createMemoryVault()
    v.set('acme', 's3cr3t')
    expect(v.get('acme')).toBe('s3cr3t')
  })
  it('returns null for a missing key and after delete', () => {
    const v = createMemoryVault()
    expect(v.get('nope')).toBeNull()
    v.set('x', '1'); v.delete('x')
    expect(v.get('x')).toBeNull()
  })
})
