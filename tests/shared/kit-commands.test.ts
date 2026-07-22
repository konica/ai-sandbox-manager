import { describe, it, expect } from 'vitest'
import { normalizeCommandsYaml } from '../../src/shared/kit-commands'

describe('normalizeCommandsYaml', () => {
  it('accepts and normalizes a commands block', () => {
    const r = normalizeCommandsYaml('commands:\n  install: |\n    apt-get update\n')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.yaml).toContain('commands:')
  })
  it('treats empty input as ok/empty', () => {
    expect(normalizeCommandsYaml('   ')).toEqual({ ok: true, yaml: '' })
  })
  it('rejects unparseable YAML', () => {
    expect(normalizeCommandsYaml('commands: [oops').ok).toBe(false)
  })
  it('rejects non-commands top-level keys', () => {
    expect(normalizeCommandsYaml('network:\n  allowedDomains: [a.com]').ok).toBe(false)
  })
  it('rejects unknown commands.* keys', () => {
    expect(normalizeCommandsYaml('commands:\n  bogus: x').ok).toBe(false)
  })
  it('rejects wrong types', () => {
    expect(normalizeCommandsYaml('commands:\n  install: [1,2]').ok).toBe(false)
    expect(normalizeCommandsYaml('commands:\n  initFiles: nope').ok).toBe(false)
  })
})
