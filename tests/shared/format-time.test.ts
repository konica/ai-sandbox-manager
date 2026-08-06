import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../../src/shared/format-time'

const NOW = Date.parse('2026-08-06T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('formatRelativeTime', () => {
  it('returns null for null/empty/unparseable input', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull()
    expect(formatRelativeTime('', NOW)).toBeNull()
    expect(formatRelativeTime('not-a-date', NOW)).toBeNull()
  })
  it('"just now" under 45 seconds', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('just now')
    expect(formatRelativeTime(ago(44_000), NOW)).toBe('just now')
  })
  it('minutes with singular/plural', () => {
    expect(formatRelativeTime(ago(60_000), NOW)).toBe('1 minute ago')
    expect(formatRelativeTime(ago(5 * 60_000), NOW)).toBe('5 minutes ago')
  })
  it('hours with singular/plural', () => {
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe('1 hour ago')
    expect(formatRelativeTime(ago(3 * 60 * 60_000), NOW)).toBe('3 hours ago')
  })
  it('days with singular/plural', () => {
    expect(formatRelativeTime(ago(24 * 60 * 60_000), NOW)).toBe('1 day ago')
    expect(formatRelativeTime(ago(2 * 24 * 60 * 60_000), NOW)).toBe('2 days ago')
  })
  it('treats a future timestamp as "just now" (clock skew)', () => {
    expect(formatRelativeTime(new Date(NOW + 10_000).toISOString(), NOW)).toBe('just now')
  })
})
