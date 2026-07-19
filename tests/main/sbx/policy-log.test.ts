import { describe, it, expect } from 'vitest'
import { parsePolicyLog } from '../../../src/main/sbx/policy-log'

// Shape from the Phase 0 spike: `sbx policy log <name> --json` → { blocked_hosts, allowed_hosts }.
const sample = JSON.stringify({
  blocked_hosts: [
    { host: 'telemetry.example.com:443', vm_name: 'box', reason: 'No matching allow rule (default deny)', last_seen: '2026-07-19T21:42:54+07:00', count_since: 2 }
  ],
  allowed_hosts: [
    { host: 'api.anthropic.com:443', vm_name: 'box', reason: 'domain-allowed', last_seen: '2026-07-19T21:42:20+07:00', count_since: 5 }
  ]
})

describe('parsePolicyLog', () => {
  it('splits allowed vs blocked and sums request counts', () => {
    const s = parsePolicyLog(sample)
    expect(s.allowed).toBe(5)
    expect(s.blocked).toBe(2)
    expect(s.events.find((e) => e.host.includes('api.anthropic.com'))?.allowed).toBe(true)
    expect(s.events.find((e) => e.host.includes('telemetry'))?.allowed).toBe(false)
  })
  it('tolerates empty / malformed input', () => {
    expect(parsePolicyLog('')).toEqual({ allowed: 0, blocked: 0, events: [] })
    expect(parsePolicyLog('not json')).toEqual({ allowed: 0, blocked: 0, events: [] })
  })
})
