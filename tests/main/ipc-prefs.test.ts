import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'

function deps() {
  const prefs = new Map<string, string>()
  const store = {
    getPref: vi.fn((k: string) => prefs.get(k) ?? null),
    setPref: vi.fn((k: string, v: string) => { prefs.set(k, v) })
  }
  return { adapter: {} as never, store, probes: {} as never, openTerminal: vi.fn() } as never
}

describe('preferences IPC', () => {
  it('returns null for an unset preference', async () => {
    const h = buildHandlers(deps())
    expect(await h['prefs:get']('defaultTier')).toEqual({ ok: true, data: null })
  })
  it('sets then gets a preference', async () => {
    const h = buildHandlers(deps())
    expect((await h['prefs:set']('defaultTier', 'balanced')).ok).toBe(true)
    const r = await h['prefs:get']('defaultTier')
    expect(r.ok && r.data).toBe('balanced')
  })
})
