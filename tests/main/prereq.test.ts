import { describe, it, expect } from 'vitest'
import { checkPrereqs, type Probes } from '@main/prereq'

const allGood: Probes = {
  hasDocker: async () => true,
  sbxVersion: async () => 'sbx 1.2.3',
  sbxAuthed: async () => true,
  freeDiskBytes: async () => 50 * 1024 ** 3,
  keychainReachable: async () => true
}

describe('checkPrereqs', () => {
  it('passes when docker, sbx, and auth are present', async () => {
    const r = await checkPrereqs(allGood)
    expect(r.ok).toBe(true)
    expect(r.checks.map((c) => c.id)).toEqual(['docker', 'sbx', 'auth', 'disk', 'keychain'])
  })

  it('blocks when sbx is not authenticated', async () => {
    const r = await checkPrereqs({ ...allGood, sbxAuthed: async () => false })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'auth')?.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'auth')?.remediation).toContain('sbx login')
  })

  it('reports low disk without blocking', async () => {
    const r = await checkPrereqs({ ...allGood, freeDiskBytes: async () => 100 * 1024 ** 2 })
    expect(r.ok).toBe(true)
    expect(r.checks.find((c) => c.id === 'disk')?.ok).toBe(false)
  })
})
