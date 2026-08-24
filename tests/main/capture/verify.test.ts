import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:net'
import { tcpProbe, verifyScript, parseVerify, verifyChecks, credentialChainOk } from '../../../src/main/capture/verify'

let server: Server | null = null
afterEach(() => { server?.close(); server = null })

function listen(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer()
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port))
  })
}

describe('tcpProbe', () => {
  it('resolves true for a bound port', async () => {
    const port = await listen()
    expect(await tcpProbe(port)).toBe(true)
  })

  it('resolves false for an unbound port', async () => {
    const port = await listen()
    await new Promise<void>((r) => server!.close(() => r()))
    server = null
    expect(await tcpProbe(port, { timeoutMs: 500 })).toBe(false)
  })

  it('never rejects', async () => {
    await expect(tcpProbe(1, { timeoutMs: 200 })).resolves.toBe(false)
  })
})

describe('verifyScript', () => {
  it('runs 12 concurrent requests through the app port', () => {
    const s = verifyScript(18080)
    expect(s).toContain('http://127.0.0.1:18080')
    expect(s).toContain('seq 1 12')
    expect(s).toContain('CONC=')
  })

  it('probes Anthropic first and falls back to GitHub', () => {
    const s = verifyScript(18080)
    expect(s).toContain('api.anthropic.com/v1/models')
    expect(s).toContain('api.github.com/user')
    expect(s).toContain('CRED=')
    expect(s).toContain('CREDHOST=')
  })
})

describe('parseVerify', () => {
  it('parses a healthy run', () => {
    const v = parseVerify('CONC=12/12\nCRED=200\nCREDHOST=anthropic\n')
    expect(v.concurrency).toEqual({ ok: 12, total: 12 })
    expect(v.credential).toEqual({ host: 'anthropic', code: 200 })
  })

  it('parses a partial concurrency failure', () => {
    expect(parseVerify('CONC=4/12\nCRED=200\nCREDHOST=github\n').concurrency).toEqual({ ok: 4, total: 12 })
  })

  it('parses the no-credential case', () => {
    expect(parseVerify('CONC=12/12\nCRED=\nCREDHOST=none\n').credential).toEqual({ host: 'none', code: null })
  })

  it('tolerates malformed or empty output', () => {
    const v = parseVerify('garbage')
    expect(v.concurrency).toEqual({ ok: 0, total: 12 })
    expect(v.credential).toEqual({ host: 'none', code: null })
    expect(parseVerify('').concurrency.ok).toBe(0)
  })
})

describe('credentialChainOk', () => {
  it('passes on 200', () => {
    expect(credentialChainOk(parseVerify('CONC=12/12\nCRED=200\nCREDHOST=anthropic\n'))).toBe(true)
  })

  it('passes on a non-401 4xx, since auth precedes request validation', () => {
    expect(credentialChainOk(parseVerify('CONC=12/12\nCRED=404\nCREDHOST=anthropic\n'))).toBe(true)
  })

  it('fails on 401 — that is Burp going direct instead of chaining', () => {
    expect(credentialChainOk(parseVerify('CONC=12/12\nCRED=401\nCREDHOST=anthropic\n'))).toBe(false)
  })

  it('is not a failure when no credential is configured to probe with', () => {
    expect(credentialChainOk(parseVerify('CONC=12/12\nCRED=\nCREDHOST=none\n'))).toBe(true)
  })
})

describe('verifyChecks', () => {
  it('reports concurrency and credential checks', () => {
    const checks = verifyChecks(parseVerify('CONC=12/12\nCRED=200\nCREDHOST=anthropic\n'))
    expect(checks.find((c) => c.id === 'concurrency')).toMatchObject({ ok: true, detail: '12/12' })
    expect(checks.find((c) => c.id === 'credential')).toMatchObject({ ok: true })
  })

  it('marks concurrency failed when not all requests succeeded', () => {
    const checks = verifyChecks(parseVerify('CONC=4/12\nCRED=200\nCREDHOST=github\n'))
    expect(checks.find((c) => c.id === 'concurrency')?.ok).toBe(false)
  })

  it('marks the credential check unverified rather than passed when nothing was probed', () => {
    const c = verifyChecks(parseVerify('CONC=12/12\nCRED=\nCREDHOST=none\n')).find((x) => x.id === 'credential')
    expect(c?.ok).toBe(false)
    expect(c?.detail).toMatch(/not verified/i)
  })
})
