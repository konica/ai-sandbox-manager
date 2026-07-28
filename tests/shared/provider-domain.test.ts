import { describe, it, expect } from 'vitest'
import { needsProviderDomainWarning } from '@shared/provider-domain'

// Single source of truth for the "no reachable domains" rule, consumed by both the wizard's
// needsProviderDomainHint (src/renderer/wizard/draft.ts) and the def:import warning
// (src/main/ipc.ts). See tests/renderer/wizard/draft.test.ts and tests/main/ipc.test.ts for the
// callers' own coverage of their thin wrappers.
describe('needsProviderDomainWarning', () => {
  it('is true for locked + an agent with no built-in domains + no domains added', () => {
    expect(needsProviderDomainWarning('opencode', 'locked', 0)).toBe(true)
  })
  it('is false once a domain is present', () => {
    expect(needsProviderDomainWarning('opencode', 'locked', 1)).toBe(false)
  })
  it('is false on the balanced or open tier', () => {
    expect(needsProviderDomainWarning('opencode', 'balanced', 0)).toBe(false)
    expect(needsProviderDomainWarning('opencode', 'open', 0)).toBe(false)
  })
  it('is false for claude, which ships its own domains', () => {
    expect(needsProviderDomainWarning('claude', 'locked', 0)).toBe(false)
  })
})
