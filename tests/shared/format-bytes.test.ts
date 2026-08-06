import { describe, it, expect } from 'vitest'
import { formatBytes } from '../../src/shared/format-bytes'

describe('formatBytes', () => {
  it('bytes under 1 KB (no decimal)', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })
  it('KB / MB / GB / TB with one decimal (1024-based)', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(312 * 1024 * 1024)).toBe('312.0 MB')
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB')
    expect(formatBytes(1.3 * 1024 ** 4)).toBe('1.3 TB')
  })
  it('negative / NaN → "0 B"', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
  })
})
