import { describe, it, expect, vi } from 'vitest'
import { buildOsascriptArgs, buildBashScript, findWindowsBash, openHostTerminal } from '../../src/main/terminal'

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
  it('opens a Git Bash window via cmd start on win32 when bash is found', () => {
    const spawn = vi.fn()
    const writeScript = vi.fn(() => 'C:\\Temp\\sbx-term\\term-1.sh')
    openHostTerminal("sbx run --name 'x' -- --continue", {
      platform: 'win32',
      spawn,
      findBash: () => 'C:\\Program Files\\Git\\bin\\bash.exe',
      writeScript
    })
    // The POSIX command goes into the script (never onto a Windows command line);
    // only the bash + script paths are spawned.
    expect(writeScript).toHaveBeenCalledWith(buildBashScript("sbx run --name 'x' -- --continue"))
    expect(spawn).toHaveBeenCalledWith('cmd.exe', [
      '/c', 'start', '', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Temp\\sbx-term\\term-1.sh'
    ])
  })

  it('falls back to PowerShell on win32 when no bash is found', () => {
    const spawn = vi.fn()
    openHostTerminal("sbx exec -it 'x' bash", { platform: 'win32', spawn, findBash: () => null })
    expect(spawn).toHaveBeenCalledWith('cmd.exe', [
      '/c', 'start', '', 'powershell', '-NoExit', '-Command', "sbx exec -it 'x' bash"
    ])
  })

  it('throws on unsupported platforms (e.g. linux)', () => {
    const spawn = vi.fn()
    expect(() => openHostTerminal('sbx run --name x', { platform: 'linux', spawn })).toThrow(/macOS/)
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('buildBashScript', () => {
  it('runs the command then drops to an interactive shell so the window stays open', () => {
    const script = buildBashScript("sbx run --name 'x' -- --continue")
    expect(script).toContain("sbx run --name 'x' -- --continue")
    expect(script.trimEnd().endsWith('exec bash -i')).toBe(true)
  })
})

describe('findWindowsBash', () => {
  // path.join uses the host separator, so compare separator-agnostically:
  // the test must pass whether run on Windows (\) or the Linux/mac CI host (/).
  const norm = (p: string): string => p.replace(/\\/g, '/')
  it('returns the Git for Windows bash when it exists', () => {
    const env = { ProgramFiles: 'C:\\Program Files' } as NodeJS.ProcessEnv
    const bash = findWindowsBash(env, (p) => norm(p) === 'C:/Program Files/Git/bin/bash.exe')
    expect(bash).not.toBeNull()
    expect(norm(bash as string)).toBe('C:/Program Files/Git/bin/bash.exe')
  })
  it('returns null when no known bash exists', () => {
    expect(findWindowsBash({} as NodeJS.ProcessEnv, () => false)).toBeNull()
  })
})
