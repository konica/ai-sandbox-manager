import { describe, it, expect } from 'vitest'
import { KNOWN_SERVICES, serviceById, serviceForEnvVar } from '../../src/shared/services'

describe('KNOWN_SERVICES', () => {
  it('has anthropic with its canonical env var and domains', () => {
    const a = serviceById('anthropic')
    expect(a?.envVars).toContain('ANTHROPIC_API_KEY')
    expect(a?.domains).toContain('api.anthropic.com')
  })
  it('maps every env var back to exactly one service', () => {
    for (const svc of KNOWN_SERVICES)
      for (const v of svc.envVars) expect(serviceForEnvVar(v)?.id).toBe(svc.id)
  })
  it('resolves GitHub aliases', () => {
    expect(serviceForEnvVar('GITHUB_TOKEN')?.id).toBe('github')
    expect(serviceForEnvVar('GH_TOKEN')?.id).toBe('github')
  })
  it('has unique ids and no empty domains', () => {
    expect(new Set(KNOWN_SERVICES.map((s) => s.id)).size).toBe(KNOWN_SERVICES.length)
    for (const s of KNOWN_SERVICES) expect(s.domains.every((d) => d.length > 0)).toBe(true)
  })
})
