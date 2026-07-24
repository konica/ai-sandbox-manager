import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '@main/store/db'

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('app preferences (app_prefs)', () => {
  it('returns null for an unset key', () => {
    expect(store.getPref('defaultTier')).toBeNull()
  })
  it('round-trips a preference value', () => {
    store.setPref('defaultTier', 'balanced')
    expect(store.getPref('defaultTier')).toBe('balanced')
  })
  it('overwrites an existing preference', () => {
    store.setPref('defaultTier', 'balanced')
    store.setPref('defaultTier', 'open')
    expect(store.getPref('defaultTier')).toBe('open')
  })
})
