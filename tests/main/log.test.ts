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
