import { describe, it, expect } from 'vitest'
import { parseDiagnoseAuth } from '../../src/main/sbx/diagnose'

const json = (auth: string | null): string =>
  JSON.stringify({
    version: '1.0',
    checks: [
      { name: 'CLI binary', status: 'pass', message: 'found' },
      ...(auth === null ? [] : [{ name: 'Authentication', status: auth, message: auth }])
    ],
    summary: { pass: 1, warn: 0, fail: 0, skip: 0 }
  })

describe('parseDiagnoseAuth', () => {
  it('returns pass when the Authentication check passed', () => {
    expect(parseDiagnoseAuth(json('pass'))).toBe('pass')
  })
  it('returns fail when the Authentication check failed', () => {
    expect(parseDiagnoseAuth(json('fail'))).toBe('fail')
  })
  it('returns unknown for a warn/skip status (never blocks on non-fail)', () => {
    expect(parseDiagnoseAuth(json('warn'))).toBe('unknown')
    expect(parseDiagnoseAuth(json('skip'))).toBe('unknown')
  })
  it('returns unknown when the Authentication check is absent', () => {
    expect(parseDiagnoseAuth(json(null))).toBe('unknown')
  })
  it('returns unknown for unparseable output', () => {
    expect(parseDiagnoseAuth('not json')).toBe('unknown')
    expect(parseDiagnoseAuth('')).toBe('unknown')
  })
})
