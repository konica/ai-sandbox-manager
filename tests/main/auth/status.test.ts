import { describe, it, expect } from 'vitest'
import { parseClaudeAuth } from '../../../src/main/auth/status'

const OAUTH = `SCOPE      TYPE      NAME        SECRET
(global)   service   anthropic   (oauth configured)`

const APIKEY = `SCOPE      TYPE      NAME        SECRET
(global)   service   anthropic   sk-ant******...******8AAA`

describe('parseClaudeAuth', () => {
  it('detects an OAuth global anthropic row', () => {
    expect(parseClaudeAuth(OAUTH)).toBe('oauth')
  })
  it('detects an API-key global anthropic row', () => {
    expect(parseClaudeAuth(APIKEY)).toBe('apikey')
  })
  it('returns none when there is no anthropic row', () => {
    expect(parseClaudeAuth('No secrets found for scope "(global)".')).toBe('none')
    expect(parseClaudeAuth('')).toBe('none')
  })
  it('ignores an anthropic row from a non-global (sandbox) scope', () => {
    expect(parseClaudeAuth('SCOPE  TYPE  NAME  SECRET\nmy-box  service  anthropic  sk-ant***')).toBe('none')
  })
})
