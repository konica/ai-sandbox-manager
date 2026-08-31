import { describe, it, expect } from 'vitest'
import { isValidCredHost } from '../../src/shared/host'

describe('isValidCredHost', () => {
  it('accepts a bare host', () => {
    expect(isValidCredHost('api.acme.com')).toBe(true)
    expect(isValidCredHost('  API.Acme.com  ')).toBe(true)
    expect(isValidCredHost('localhost')).toBe(true)
  })

  it('accepts the wildcard patterns sbx documents', () => {
    expect(isValidCredHost('*.coderabbit.ai')).toBe(true)
    expect(isValidCredHost('**.example.com')).toBe(true)
    expect(isValidCredHost('*')).toBe(true)
  })

  it('accepts IPv4 and bracketed IPv6 literals', () => {
    expect(isValidCredHost('10.0.0.5')).toBe(true)
    expect(isValidCredHost('[::1]')).toBe(true)
  })

  it('rejects a pasted API base URL — sbx refuses a scheme outright', () => {
    expect(isValidCredHost('https://api.mem0.ai')).toBe(false)
    expect(isValidCredHost('http://api.smith.langchain.com')).toBe(false)
    expect(isValidCredHost('https://api.mem0.ai/v1/memories')).toBe(false)
  })

  it('rejects a port, path, query, fragment, or userinfo', () => {
    expect(isValidCredHost('api.mem0.ai:443')).toBe(false)
    expect(isValidCredHost('[::1]:8080')).toBe(false)
    expect(isValidCredHost('api.mem0.ai/v1')).toBe(false)
    expect(isValidCredHost('api.mem0.ai?k=1')).toBe(false)
    expect(isValidCredHost('api.mem0.ai#frag')).toBe(false)
    expect(isValidCredHost('user:pw@api.mem0.ai')).toBe(false)
  })

  it('rejects empty input and characters sbx would refuse', () => {
    expect(isValidCredHost('')).toBe(false)
    expect(isValidCredHost('   ')).toBe(false)
    expect(isValidCredHost('api mem0 ai')).toBe(false)
    expect(isValidCredHost('api_mem0!.ai')).toBe(false)
    expect(isValidCredHost('api.mem0.ai.')).toBe(false)
    expect(isValidCredHost('..')).toBe(false)
  })
})
