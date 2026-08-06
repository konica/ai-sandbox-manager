import { describe, it, expect } from 'vitest'
import { buildHandlers } from '@main/ipc'

const probe = 'cpu_usec 0 2000000\ncpu_elapsed_ns 1000000000\nnproc 2\nmem_current 100\nmem_max 200\ndisk 10 4\n'

function deps(execCapture: (name: string, script: string) => Promise<string>) {
  return {
    adapter: { execCapture } as never,
    store: {} as never,
    probes: {} as never,
    openTerminal: () => {}
  }
}

describe('instance:stats', () => {
  it('returns parsed ResourceStats on success', async () => {
    const h = buildHandlers(deps(async () => probe))
    const res = await h['instance:stats']('proj-a1')
    expect(res.ok).toBe(true)
    expect(res.ok && res.data.cpu).toEqual({ cores: 2, ofCpus: 2 })
    expect(res.ok && res.data.memory).toEqual({ usedBytes: 100, limitBytes: 200 })
  })
  it('returns Result error when the probe throws', async () => {
    const h = buildHandlers(deps(async () => { throw new Error('not running') }))
    const res = await h['instance:stats']('proj-a1')
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error.message).toMatch(/not running/)
  })
})
