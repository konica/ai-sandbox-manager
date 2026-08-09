import { describe, it, expect } from 'vitest'
import { readHostCapacity } from '../../src/main/host/capacity'
import { buildHandlers } from '../../src/main/ipc'

describe('readHostCapacity', () => {
  it('reports core count and total memory from the os module', () => {
    const fakeOs = { cpus: () => new Array(4).fill({ model: 'x' }), totalmem: () => 8 * 1024 ** 3 }
    expect(readHostCapacity(fakeOs as unknown as typeof import('node:os'))).toEqual({
      cpuCores: 4,
      totalMemBytes: 8 * 1024 ** 3
    })
  })
})

describe('host:capacity handler', () => {
  it('returns an ok Result with capacity', async () => {
    // buildHandlers needs a Deps object; only the host:capacity handler is exercised here.
    const handlers = buildHandlers({} as unknown as Parameters<typeof buildHandlers>[0])
    const res = await handlers['host:capacity']()
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(typeof res.data.cpuCores).toBe('number')
      expect(res.data.cpuCores).toBeGreaterThan(0)
      expect(typeof res.data.totalMemBytes).toBe('number')
    }
  })
})
