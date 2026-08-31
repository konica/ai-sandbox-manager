import { describe, it, expect } from 'vitest'
import { createLogger, formatLine } from '../../src/main/log'

describe('formatLine', () => {
  it('includes timestamp, level, and text', () => {
    expect(formatLine('INFO', 'hello', '2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z [INFO] hello')
  })
})

describe('createLogger', () => {
  it('emits info/command/error to the sink with a fixed clock', () => {
    const lines: string[] = []
    const log = createLogger({ sink: (l) => lines.push(l), clock: () => 'T' })
    log.info('starting')
    log.command(['create', 'claude', '/p', '--name', 'x'])
    log.error('boom')
    expect(lines).toEqual([
      'T [INFO] starting',
      'T [CMD] $ sbx create claude /p --name x',
      'T [ERROR] boom'
    ])
  })

  it('does not throw when the log file cannot be written', () => {
    const log = createLogger({ file: '/no/such/dir/nope.log', clock: () => 'T', sink: () => {} })
    expect(() => log.info('x')).not.toThrow()
  })
})

// `sbx secret set-custom` has no stdin path, so the value is forced onto argv. It must not also be
// forced into a log file that users routinely paste into bug reports.
describe('createLogger secret redaction', () => {
  function lines(argv: string[]): string {
    const out: string[] = []
    createLogger({ sink: (l) => out.push(l), clock: () => 'T' }).command(argv)
    return out[0]
  }

  it('masks the value after --value', () => {
    const line = lines(['secret', 'set-custom', 'box-1', '--host', 'api.acme.com', '--env', 'ACME_KEY', '--value', 'sk-live-do-not-log'])
    expect(line).not.toContain('sk-live-do-not-log')
    expect(line).toBe('T [CMD] $ sbx secret set-custom box-1 --host api.acme.com --env ACME_KEY --value ••••')
  })

  it('masks the value after the short -t and the long --token form', () => {
    expect(lines(['secret', 'set-custom', '-t', 'tok-secret'])).toBe('T [CMD] $ sbx secret set-custom -t ••••')
    expect(lines(['secret', 'set-custom', '--token', 'tok-secret'])).toBe('T [CMD] $ sbx secret set-custom --token ••••')
  })

  it('masks an inline --value=secret as well as the separated form', () => {
    const line = lines(['secret', 'set-custom', '--value=sk-inline-secret'])
    expect(line).not.toContain('sk-inline-secret')
    expect(line).toBe('T [CMD] $ sbx secret set-custom --value=••••')
  })

  it('leaves a command carrying no secret completely untouched', () => {
    expect(lines(['secret', 'ls', 'box-1'])).toBe('T [CMD] $ sbx secret ls box-1')
    expect(lines(['create', 'claude', '/p', '--name', 'x'])).toBe('T [CMD] $ sbx create claude /p --name x')
  })

  it('does not mask a bare trailing flag with no value after it', () => {
    expect(lines(['secret', 'set-custom', '--value'])).toBe('T [CMD] $ sbx secret set-custom --value')
  })
})

