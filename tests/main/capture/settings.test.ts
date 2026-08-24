import { describe, it, expect } from 'vitest'
import { readBurpSettings, writeBurpSettings, isValidPort } from '../../../src/main/capture/settings'
import { CAPTURE_DEFAULTS } from '../../../src/shared/capture'

function fakeStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getPref: (k: string) => map.get(k) ?? null,
    setPref: (k: string, v: string) => { map.set(k, v) },
    all: () => Object.fromEntries(map)
  }
}

describe('isValidPort', () => {
  it('accepts 1..65535 integers only', () => {
    expect(isValidPort(8080)).toBe(true)
    expect(isValidPort(1)).toBe(true)
    expect(isValidPort(65535)).toBe(true)
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(65536)).toBe(false)
    expect(isValidPort(80.5)).toBe(false)
    expect(isValidPort('8080')).toBe(false)
    expect(isValidPort(NaN)).toBe(false)
  })
})

describe('readBurpSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readBurpSettings(fakeStore())).toEqual({
      caPath: '',
      proxyPort: CAPTURE_DEFAULTS.proxyPort,
      upstreamPort: CAPTURE_DEFAULTS.upstreamPort
    })
  })

  it('reads stored values', () => {
    const s = fakeStore({ 'burp.caPath': 'C:/ca.cer', 'burp.proxyPort': '8081', 'burp.upstreamPort': '3200' })
    expect(readBurpSettings(s)).toEqual({ caPath: 'C:/ca.cer', proxyPort: 8081, upstreamPort: 3200 })
  })

  it('falls back to the default when a stored port is unparseable or out of range', () => {
    const s = fakeStore({ 'burp.proxyPort': 'not-a-number', 'burp.upstreamPort': '0' })
    const r = readBurpSettings(s)
    expect(r.proxyPort).toBe(CAPTURE_DEFAULTS.proxyPort)
    expect(r.upstreamPort).toBe(CAPTURE_DEFAULTS.upstreamPort)
  })
})

describe('writeBurpSettings', () => {
  it('patches only the provided keys and returns the merged result', () => {
    const s = fakeStore({ 'burp.caPath': 'C:/ca.cer' })
    const r = writeBurpSettings(s, { proxyPort: 9090 })
    expect(r).toEqual({ caPath: 'C:/ca.cer', proxyPort: 9090, upstreamPort: CAPTURE_DEFAULTS.upstreamPort })
    expect(s.all()['burp.proxyPort']).toBe('9090')
  })

  it('rejects an invalid port instead of persisting it', () => {
    const s = fakeStore()
    expect(() => writeBurpSettings(s, { proxyPort: 0 })).toThrow(/port/i)
    expect(s.all()['burp.proxyPort']).toBeUndefined()
  })

  it('trims the CA path', () => {
    const s = fakeStore()
    expect(writeBurpSettings(s, { caPath: '  C:/x.cer  ' }).caPath).toBe('C:/x.cer')
  })
})
