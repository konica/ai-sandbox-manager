import { describe, it, expect } from 'vitest'
import { parseResourceStats } from '../../src/shared/resource-stats'

const v2 = [
  'cpu_usec 1000000 1500000',   // Δ 500000 µs = 0.5 cpu-seconds
  'cpu_elapsed_ns 1000000000',  // 1.0 s
  'nproc 4',
  'mem_current 314572800',      // 300 MB
  'mem_max 2147483648',         // 2 GB
  'disk 10000000000 4000000000'
].join('\n')

describe('parseResourceStats', () => {
  it('parses a full cgroup-v2 sample', () => {
    const s = parseResourceStats(v2)
    expect(s.cpu).toEqual({ cores: 0.5, ofCpus: 4 })
    expect(s.memory).toEqual({ usedBytes: 314572800, limitBytes: 2147483648 })
    expect(s.disk).toEqual({ totalBytes: 10000000000, usedBytes: 4000000000 })
  })
  it('treats mem_max "max" as unlimited (limitBytes null)', () => {
    const s = parseResourceStats('mem_current 100\nmem_max max')
    expect(s.memory).toEqual({ usedBytes: 100, limitBytes: null })
  })
  it('a bare key with no value is null, not 0', () => {
    expect(parseResourceStats('mem_current\nmem_max 100').memory).toBeNull()
    expect(parseResourceStats('mem_current 50\nmem_max').memory).toEqual({ usedBytes: 50, limitBytes: null })
  })
  it('cpu null when a cpu field is missing or elapsed is zero', () => {
    expect(parseResourceStats('nproc 4\nmem_current 1').cpu).toBeNull()
    expect(parseResourceStats('cpu_usec 1 2\ncpu_elapsed_ns 0\nnproc 4').cpu).toBeNull()
  })
  it('memory/disk null when their lines are missing', () => {
    const s = parseResourceStats('nproc 2')
    expect(s.memory).toBeNull()
    expect(s.disk).toBeNull()
  })
  it('all null for empty/garbage input', () => {
    const s = parseResourceStats('garbage\n\nnonsense line')
    expect(s).toEqual({ cpu: null, memory: null, disk: null })
  })
})
