import { describe, it, expect } from 'vitest'
import { scanEnv, maskValue } from '../../../src/main/creds/env-scan'

describe('scanEnv', () => {
  it('finds anthropic + github (via alias) and masks values', () => {
    const hits = scanEnv({ ANTHROPIC_API_KEY: 'sk-ant-abcdef123', GH_TOKEN: 'gho_secret', UNRELATED: 'x' })
    const ids = hits.map((h) => h.serviceId)
    expect(ids).toContain('anthropic')
    expect(ids).toContain('github')
    const a = hits.find((h) => h.serviceId === 'anthropic')!
    expect(a.envVar).toBe('ANTHROPIC_API_KEY')
    expect(a.masked).toBe('sk-ant…')
    expect(a.masked).not.toContain('123')
  })
  it('ignores empty values and returns one hit per service', () => {
    expect(scanEnv({ OPENAI_API_KEY: '' })).toEqual([])
  })
})

describe('maskValue', () => {
  it('shows only the first six chars', () => {
    expect(maskValue('abcdefghij')).toBe('abcdef…')
    expect(maskValue('short')).toBe('…')
  })
})
