import { describe, it, expect, vi } from 'vitest'
import { buildOsascriptArgs, openHostTerminal } from '../../src/main/terminal'

describe('buildOsascriptArgs', () => {
  it('wraps the command in a Terminal do-script tell block', () => {
    const args = buildOsascriptArgs('sbx run --name x')
    expect(args[0]).toBe('-e')
    expect(args[1]).toContain('tell application "Terminal"')
    expect(args[1]).toContain('do script')
    expect(args[1]).toContain('sbx run --name x')
  })
  it('escapes embedded double quotes and backslashes', () => {
    const args = buildOsascriptArgs(`sbx exec -it 'a b' bash`)
    expect(args).toHaveLength(2)
    expect(args[1].startsWith('tell application "Terminal"')).toBe(true)
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
