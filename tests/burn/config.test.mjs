import { describe, it, expect } from 'vitest'
import { DEFAULTS, loadConfig } from '../../scripts/burn/config.mjs'

describe('loadConfig', () => {
  it('returns defaults when given nothing', () => {
    expect(loadConfig()).toEqual(DEFAULTS)
    expect(loadConfig({})).toEqual(DEFAULTS)
  })

  it('overlays provided keys onto defaults', () => {
    const cfg = loadConfig({ maxConcurrent: 4, ciWorkflow: 'ci.yml' })
    expect(cfg.maxConcurrent).toBe(4)
    expect(cfg.ciWorkflow).toBe('ci.yml')
    expect(cfg.readyLabel).toBe(DEFAULTS.readyLabel)
  })

  it('rejects an unknown key by name rather than ignoring it', () => {
    expect(() => loadConfig({ redyLabel: 'x' })).toThrow(/redyLabel/)
  })

  it('rejects a non-object config', () => {
    expect(() => loadConfig([])).toThrow(/object/i)
    expect(() => loadConfig(null)).toThrow(/object/i)
  })

  it('rejects an out-of-range maxConcurrent', () => {
    expect(() => loadConfig({ maxConcurrent: 0 })).toThrow(/maxConcurrent/)
    expect(() => loadConfig({ maxConcurrent: 1.5 })).toThrow(/maxConcurrent/)
  })

  it('allows maxCiRetries of zero but rejects negatives', () => {
    expect(loadConfig({ maxCiRetries: 0 }).maxCiRetries).toBe(0)
    expect(() => loadConfig({ maxCiRetries: -1 })).toThrow(/maxCiRetries/)
  })

  it('rejects an unknown order mode', () => {
    expect(() => loadConfig({ order: 'alphabetical' })).toThrow(/order/)
  })

  it('rejects empty or non-string verifyCommands', () => {
    expect(() => loadConfig({ verifyCommands: [] })).toThrow(/verifyCommands/)
    expect(() => loadConfig({ verifyCommands: ['npm test', 3] })).toThrow(/verifyCommands/)
  })

  it('rejects blank string keys', () => {
    expect(() => loadConfig({ readyLabel: '  ' })).toThrow(/readyLabel/)
  })

  it('does not mutate DEFAULTS', () => {
    loadConfig({ maxConcurrent: 9 })
    expect(DEFAULTS.maxConcurrent).toBe(2)
  })
})
