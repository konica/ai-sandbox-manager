import { describe, it, expect } from 'vitest'
import { draftReducer, initialDraft, toSpec, draftFromSpec, TOTAL_STEPS } from '../../../src/renderer/wizard/draft'

const base = { ...initialDraft, workspace: '/p', name: 'p' }

describe('wizard step count', () => {
  it('has 8 total steps (mcp step inserted between credentials and ports)', () => {
    expect(TOTAL_STEPS).toBe(8)
  })
})

describe('draft mcp', () => {
  it('defaults to off with no servers', () => {
    expect(base.mcpMode).toBe('off')
    expect(base.mcpServers).toEqual([])
  })

  it('setMcpMode changes the mode', () => {
    const d = draftReducer(base, { type: 'setMcpMode', mode: 'dynamic' })
    expect(d.mcpMode).toBe('dynamic')
  })

  it('toggleMcpServer adds then removes a server name', () => {
    let d = draftReducer(base, { type: 'toggleMcpServer', name: 'github' })
    expect(d.mcpServers).toEqual(['github'])
    d = draftReducer(d, { type: 'toggleMcpServer', name: 'sentry' })
    expect(d.mcpServers).toEqual(['github', 'sentry'])
    d = draftReducer(d, { type: 'toggleMcpServer', name: 'github' })
    expect(d.mcpServers).toEqual(['sentry'])
  })

  it('toSpec omits mcp entirely when mode is off', () => {
    const d = { ...base, mcpMode: 'off' as const, mcpServers: ['github'] }
    expect(toSpec(d, 'id1', 't').mcp).toBeUndefined()
  })

  it('toSpec emits dynamic mode with an empty servers list, ignoring any staged selection', () => {
    const d = { ...base, mcpMode: 'dynamic' as const, mcpServers: ['github'] }
    expect(toSpec(d, 'id1', 't').mcp).toEqual({ mode: 'dynamic', servers: [] })
  })

  it('toSpec emits static mode with the selected servers', () => {
    const d = { ...base, mcpMode: 'static' as const, mcpServers: ['github', 'sentry'] }
    expect(toSpec(d, 'id1', 't').mcp).toEqual({ mode: 'static', servers: ['github', 'sentry'] })
  })

  it('round-trips off through draftFromSpec', () => {
    const spec = toSpec(base, 'id1', 't')
    const d2 = draftFromSpec(spec)
    expect(d2.mcpMode).toBe('off')
    expect(d2.mcpServers).toEqual([])
  })

  it('round-trips static + servers through draftFromSpec', () => {
    const d = { ...base, mcpMode: 'static' as const, mcpServers: ['github', 'sentry'] }
    const spec = toSpec(d, 'id1', 't')
    const d2 = draftFromSpec(spec)
    expect(d2.mcpMode).toBe('static')
    expect(d2.mcpServers).toEqual(['github', 'sentry'])
  })

  it('round-trips dynamic mode (servers dropped, per off/dynamic semantics)', () => {
    const d = { ...base, mcpMode: 'dynamic' as const, mcpServers: ['github'] }
    const spec = toSpec(d, 'id1', 't')
    const d2 = draftFromSpec(spec)
    expect(d2.mcpMode).toBe('dynamic')
    expect(d2.mcpServers).toEqual([])
  })
})
