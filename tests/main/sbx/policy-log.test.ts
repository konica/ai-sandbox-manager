import { describe, it, expect } from 'vitest'
import { parsePolicyLog } from '../../../src/main/sbx/policy-log'

// Shape from the Phase 0 spike: `sbx policy log <name> --json` → { blocked_hosts, allowed_hosts }.
const sample = JSON.stringify({
  blocked_hosts: [
    { host: 'telemetry.example.com:443', vm_name: 'box', proxy_type: 'forward-bypass', reason: 'No matching allow rule (default deny)', last_seen: '2026-07-19T21:42:54+07:00', count_since: 2 }
  ],
  allowed_hosts: [
    { host: 'api.anthropic.com:443', vm_name: 'box', proxy_type: 'forward', reason: 'domain-allowed', last_seen: '2026-07-19T21:42:20+07:00', count_since: 5 }
  ]
})

describe('parsePolicyLog', () => {
  it('splits allowed vs blocked and sums request counts', () => {
    const s = parsePolicyLog(sample)
    expect(s.allowed).toBe(5)
    expect(s.blocked).toBe(2)
    expect(s.events.find((e) => e.host.includes('api.anthropic.com'))?.allowed).toBe(true)
    expect(s.events.find((e) => e.host.includes('api.anthropic.com'))?.count).toBe(5)
    expect(s.events.find((e) => e.host.includes('telemetry'))?.allowed).toBe(false)
    expect(s.events.find((e) => e.host.includes('telemetry'))?.count).toBe(2)
  })
  it('tolerates empty / malformed input', () => {
    expect(parsePolicyLog('')).toEqual({ allowed: 0, blocked: 0, events: [] })
    expect(parsePolicyLog('not json')).toEqual({ allowed: 0, blocked: 0, events: [] })
  })
  it('does not show an allowed host as blocked (sbx keeps the historical blocked row)', () => {
    const both = JSON.stringify({
      allowed_hosts: [{ host: 'download.docker.com:443', reason: 'domain-allowed', last_seen: 'b', count_since: 1 }],
      blocked_hosts: [{ host: 'download.docker.com:443', reason: 'default deny', last_seen: 'a', count_since: 3 }]
    })
    const s = parsePolicyLog(both)
    expect(s.blocked).toBe(0)
    expect(s.events).toHaveLength(1)
    expect(s.events[0].allowed).toBe(true)
  })
  it('parses proxy_type into each event (allowed + blocked)', () => {
    const s = parsePolicyLog(sample)
    expect(s.events.find((e) => e.host.includes('api.anthropic.com'))?.proxyType).toBe('forward')
    expect(s.events.find((e) => e.host.includes('telemetry'))?.proxyType).toBe('forward-bypass')
  })
  it('defaults proxyType to "" when the field is absent', () => {
    const s = parsePolicyLog(JSON.stringify({ allowed_hosts: [{ host: 'x.com:443', last_seen: 'a', count_since: 1 }], blocked_hosts: [] }))
    expect(s.events[0].proxyType).toBe('')
  })
})
