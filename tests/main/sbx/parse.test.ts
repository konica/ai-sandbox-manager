import { describe, it, expect } from 'vitest'
import { parseSbxLsJson, parseSbxLsText } from '@main/sbx/parse'

describe('parseSbxLsText', () => {
  it('parses the documented table layout', () => {
    const out = [
      'SANDBOX             AGENT   STATUS    PORTS                       WORKSPACE',
      'my-sandbox          claude  running   127.0.0.1:8080->3000/tcp    /home/user/proj',
      'idle-box            claude  stopped   -                           /home/user/other'
    ].join('\n')
    const rows = parseSbxLsText(out)
    expect(rows).toEqual([
      { name: 'my-sandbox', status: 'running', agent: 'claude', ports: ['127.0.0.1:8080->3000/tcp'], workspace: '/home/user/proj' },
      { name: 'idle-box', status: 'stopped', agent: 'claude', ports: [], workspace: '/home/user/other' }
    ])
  })
  it('returns [] for a header-only / empty listing', () => {
    expect(parseSbxLsText('SANDBOX AGENT STATUS PORTS WORKSPACE\n')).toEqual([])
    expect(parseSbxLsText('')).toEqual([])
  })
  it('maps unknown status strings to "unknown"', () => {
    const out = 'SANDBOX  AGENT   STATUS   PORTS  WORKSPACE\nx  claude  paused   -  /w'
    expect(parseSbxLsText(out)[0].status).toBe('unknown')
  })
})

describe('parseSbxLsJson', () => {
  it('parses the real { "sandboxes": [...] } envelope with a workspaces array', () => {
    const json = JSON.stringify({
      sandboxes: [
        { name: 'claude-mgm-rag-ingest-console', id: '32b', agent: 'claude', status: 'stopped', workspaces: ['/Users/ttdinh/Projects/mgm-rag-ingest-console'] }
      ]
    })
    expect(parseSbxLsJson(json)).toEqual([
      { name: 'claude-mgm-rag-ingest-console', status: 'stopped', agent: 'claude', ports: [], workspace: '/Users/ttdinh/Projects/mgm-rag-ingest-console' }
    ])
  })
  it('still accepts a bare top-level array', () => {
    const json = JSON.stringify([
      { name: 'my-sandbox', agent: 'claude', status: 'running', ports: ['127.0.0.1:8080->3000/tcp'], workspace: '/home/user/proj' }
    ])
    expect(parseSbxLsJson(json)).toEqual([
      { name: 'my-sandbox', status: 'running', agent: 'claude', ports: ['127.0.0.1:8080->3000/tcp'], workspace: '/home/user/proj' }
    ])
  })
  it('returns [] for an empty or shapeless JSON object', () => {
    expect(parseSbxLsJson('{"sandboxes": []}')).toEqual([])
    expect(parseSbxLsJson('{}')).toEqual([])
  })
  it('throws on non-JSON so the caller can fall back to text', () => {
    expect(() => parseSbxLsJson('SANDBOX AGENT ...')).toThrow()
  })
})
