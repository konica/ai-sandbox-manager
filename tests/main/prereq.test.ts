import { describe, it, expect } from 'vitest'
import { checkPrereqs, type Probes } from '@main/prereq'

const allGood: Probes = {
  dockerVersion: async () => 'Docker version 24.0.7',
  sbxVersion: async () => 'v0.35.0',
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

  it('reports the sbx version as a raw value when present', async () => {
    const r = await checkPrereqs(allGood)
    const sbx = r.checks.find((c) => c.id === 'sbx')
    expect(sbx?.ok).toBe(true)
    expect(sbx?.value).toContain('v0.35.0')
  })

  it('marks sbx absent when the version probe returns null', async () => {
    const r = await checkPrereqs({ ...allGood, sbxVersion: async () => null })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'sbx')?.ok).toBe(false)
  })

  it('blocks when sbx is not authenticated', async () => {
    const r = await checkPrereqs({ ...allGood, sbxAuthed: async () => false })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'auth')?.ok).toBe(false)
  })

  it('does not run the auth probe when sbx is absent', async () => {
    let authRan = false
    await checkPrereqs({ ...allGood, sbxVersion: async () => null, sbxAuthed: async () => { authRan = true; return true } })
    expect(authRan).toBe(false)
  })

  it('reports low disk without blocking', async () => {
    const r = await checkPrereqs({ ...allGood, freeDiskBytes: async () => 100 * 1024 ** 2 })
    expect(r.ok).toBe(true)
    expect(r.checks.find((c) => c.id === 'disk')?.ok).toBe(false)
  })
})
