import { describe, it, expect } from 'vitest'
import { normalizeCredHost } from '../../src/shared/host'

describe('normalizeCredHost', () => {
  it('strips a scheme (the shape people paste from API docs)', () => {
    expect(normalizeCredHost('https://api.mem0.ai')).toBe('api.mem0.ai')
    expect(normalizeCredHost('http://api.smith.langchain.com')).toBe('api.smith.langchain.com')
  })

  it('strips path, query, fragment, trailing slash and port', () => {
    expect(normalizeCredHost('https://api.mem0.ai/v1/memories')).toBe('api.mem0.ai')
    expect(normalizeCredHost('https://api.mem0.ai/')).toBe('api.mem0.ai')
    expect(normalizeCredHost('api.mem0.ai:443')).toBe('api.mem0.ai')
    expect(normalizeCredHost('https://api.mem0.ai:8443/v1?k=1#frag')).toBe('api.mem0.ai')
  })

  it('strips userinfo and lowercases, and drops a trailing root dot', () => {
    expect(normalizeCredHost('https://user:pw@API.Mem0.AI/')).toBe('api.mem0.ai')
    expect(normalizeCredHost('API.MEM0.AI.')).toBe('api.mem0.ai')
  })

  it('passes an already-bare host through unchanged', () => {
    expect(normalizeCredHost('api.acme.com')).toBe('api.acme.com')
  })

  it('keeps wildcard patterns, which sbx accepts as targets', () => {
    expect(normalizeCredHost('*.coderabbit.ai')).toBe('*.coderabbit.ai')
    expect(normalizeCredHost('**.example.com')).toBe('**.example.com')
    expect(normalizeCredHost('*')).toBe('*')
  })

  it('keeps IPv4 and bracketed IPv6 literals (port stripped, brackets kept)', () => {
    expect(normalizeCredHost('10.0.0.5')).toBe('10.0.0.5')
    expect(normalizeCredHost('http://10.0.0.5:8080/x')).toBe('10.0.0.5')
    expect(normalizeCredHost('[::1]:8080')).toBe('[::1]')
  })

  it('returns null for input with no usable host', () => {
    expect(normalizeCredHost('')).toBeNull()
    expect(normalizeCredHost('   ')).toBeNull()
    expect(normalizeCredHost('https://')).toBeNull()
    expect(normalizeCredHost('/just/a/path')).toBeNull()
  })

  it('returns null for a host with characters sbx would reject', () => {
    expect(normalizeCredHost('api mem0 ai')).toBeNull()
    expect(normalizeCredHost('api_mem0!.ai')).toBeNull()
    expect(normalizeCredHost('..')).toBeNull()
  })
})
