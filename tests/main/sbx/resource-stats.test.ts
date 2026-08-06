import { describe, it, expect, vi } from 'vitest'
import { createSbxAdapter, type SpawnFn } from '../../../src/main/sbx/adapter'
import { fetchResourceStats, RESOURCE_PROBE_SCRIPT } from '../../../src/main/sbx/resource-stats'

describe('execCapture', () => {
  it('runs `sbx exec <name> bash -lc <script>` and returns stdout', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({ stdout: 'nproc 4\n', stderr: '', code: 0 }))
    const adapter = createSbxAdapter(spawn)
    const out = await adapter.execCapture('proj-a1', 'echo hi')
    expect(out).toBe('nproc 4\n')
    expect(spawn).toHaveBeenCalledWith('sbx', ['exec', 'proj-a1', 'bash', '-lc', 'echo hi'], expect.anything())
  })
})

describe('fetchResourceStats', () => {
  it('runs the probe script and parses the output', async () => {
    const stdout = 'cpu_usec 0 1000000\ncpu_elapsed_ns 1000000000\nnproc 2\nmem_current 100\nmem_max max\ndisk 10 4\n'
    const adapter = { execCapture: vi.fn(async () => stdout) }
    const stats = await fetchResourceStats(adapter, 'proj-a1')
    expect(adapter.execCapture).toHaveBeenCalledWith('proj-a1', RESOURCE_PROBE_SCRIPT)
    expect(stats.cpu).toEqual({ cores: 1, ofCpus: 2 })
    expect(stats.memory).toEqual({ usedBytes: 100, limitBytes: null })
    expect(stats.disk).toEqual({ totalBytes: 10, usedBytes: 4 })
  })
})
