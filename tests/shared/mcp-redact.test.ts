import { describe, it, expect } from 'vitest'
import { redactMcpEndpoint } from '../../src/shared/mcp-redact'

describe('redactMcpEndpoint', () => {
  it('leaves plain endpoints untouched', () => {
    expect(redactMcpEndpoint('https://mcp.example.com/sse')).toBe('https://mcp.example.com/sse')
    expect(redactMcpEndpoint('npx @modelcontextprotocol/server-github')).toBe('npx @modelcontextprotocol/server-github')
  })

  it('redacts secret-looking query params in URLs, leaving others intact', () => {
    const out = redactMcpEndpoint('https://mcp.example.com/sse?api_key=sk-12345&region=us')
    expect(out).not.toContain('sk-12345')
    expect(out).toContain('region=us')
  })

  it('redacts basic-auth credentials embedded in a URL', () => {
    const out = redactMcpEndpoint('https://user:hunter2@mcp.example.com/sse')
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('user:hunter2')
  })

  it('redacts secret-looking flags in a local command, leaving other flags intact', () => {
    const out = redactMcpEndpoint('npx server --api-key sk-12345 --port 8080')
    expect(out).not.toContain('sk-12345')
    expect(out).toContain('--port 8080')
  })

  it('redacts KEY=value style env assignments', () => {
    const out = redactMcpEndpoint('GITHUB_TOKEN=ghp_abc123 npx server-github')
    expect(out).not.toContain('ghp_abc123')
  })

  it('is idempotent', () => {
    const once = redactMcpEndpoint('https://mcp.example.com/sse?token=sk-12345')
    expect(redactMcpEndpoint(once)).toBe(once)
  })
})
