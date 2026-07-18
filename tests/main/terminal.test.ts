import { describe, it, expect, vi } from 'vitest'
import { buildOsascriptArgs, openHostTerminal } from '../../src/main/terminal'

describe('buildOsascriptArgs', () => {
  it('opens Terminal, runs the command, and brings it to the foreground', () => {
    const joined = buildOsascriptArgs('sbx run --name x').join('\n')
    expect(joined).toContain('tell application "Terminal"')
    expect(joined).toContain('do script "sbx run --name x"')
    expect(joined).toContain('activate')
  })
  it('escapes embedded double quotes and backslashes', () => {
    const joined = buildOsascriptArgs('echo "hi" \\ there').join('\n')
    expect(joined).toContain('do script "echo \\"hi\\" \\\\ there"')
  })
  it('passes each AppleScript statement as its own -e flag', () => {
    const args = buildOsascriptArgs('x')
    for (let i = 0; i < args.length; i += 2) expect(args[i]).toBe('-e')
  })
})

describe('openHostTerminal', () => {
  it('spawns osascript on darwin', () => {
    const spawn = vi.fn()
    openHostTerminal('sbx run --name x', { platform: 'darwin', spawn })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0][0]).toBe('osascript')
    expect(spawn.mock.calls[0][1]).toEqual(buildOsascriptArgs('sbx run --name x'))
  })
  it('throws on non-darwin platforms', () => {
    const spawn = vi.fn()
    expect(() => openHostTerminal('sbx run --name x', { platform: 'linux', spawn })).toThrow(/macOS/)
    expect(spawn).not.toHaveBeenCalled()
  })
})
