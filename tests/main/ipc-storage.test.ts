import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'

const base = { adapter: {} as never, store: {} as never, probes: {} as never, openTerminal: vi.fn() }

describe('creds:storageStatus IPC', () => {
  it('returns the injected storage status', async () => {
    const h = buildHandlers({ ...base, storageStatus: () => ({ platform: 'linux', backend: 'basic_text', secure: false }) } as never)
    const r = await h['creds:storageStatus']()
    expect(r).toEqual({ ok: true, data: { platform: 'linux', backend: 'basic_text', secure: false } })
  })
})
