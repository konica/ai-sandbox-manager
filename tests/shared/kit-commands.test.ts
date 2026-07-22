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
  it('accepts the real kit schema: install as a list of {description, command} steps', () => {
    const src = 'commands:\n  install:\n    - description: "pkgs"\n      command: |\n        apt-get update\n    - description: "npm"\n      command: npm install -g npm@10\n'
    const r = normalizeCommandsYaml(src)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.yaml).toContain('install:'); expect(r.yaml).toContain('description'); expect(r.yaml).toContain('apt-get update') }
  })
  it('accepts initFiles as a list of {path, contents} entries', () => {
    const r = normalizeCommandsYaml('commands:\n  initFiles:\n    - path: /home/agent/.npmrc\n      contents: |\n        registry=https://example.com\n')
    expect(r.ok).toBe(true)
  })
  it('does not enforce the internal commands shape — deep validation is sbx kit validate (advisory)', () => {
    // Both a string install and a list install parse to a valid `commands:` mapping and pass the gate.
    expect(normalizeCommandsYaml('commands:\n  install: echo hi\n').ok).toBe(true)
    expect(normalizeCommandsYaml('commands:\n  install: [1,2]\n').ok).toBe(true)
  })
  it('rejects a non-mapping commands value', () => {
    expect(normalizeCommandsYaml('commands: just-a-string').ok).toBe(false)
    expect(normalizeCommandsYaml('commands:\n  - a\n  - b').ok).toBe(false)
  })
})
