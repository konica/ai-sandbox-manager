import { describe, it, expect } from 'vitest'
import {
  parseListOutput, basenameAny, posixJoin, resolveSandboxPath,
  LS_PWD_MARK, LS_ERR_MARK
} from '../../src/shared/copy'

describe('basenameAny', () => {
  it('handles posix, windows, and trailing separators', () => {
    expect(basenameAny('/home/user/report.csv')).toBe('report.csv')
    expect(basenameAny('C:\\proj\\logs\\')).toBe('logs')
    expect(basenameAny('plain')).toBe('plain')
  })
})

describe('posixJoin', () => {
  it('joins with a single slash', () => {
    expect(posixJoin('/workspace', 'a.txt')).toBe('/workspace/a.txt')
    expect(posixJoin('/workspace/', 'a.txt')).toBe('/workspace/a.txt')
    expect(posixJoin('', 'a.txt')).toBe('a.txt')
  })
})

describe('resolveSandboxPath', () => {
  it('passes absolute and ~ through, joins relative onto the default', () => {
    expect(resolveSandboxPath('/workspace', '/etc/hosts')).toBe('/etc/hosts')
    expect(resolveSandboxPath('/workspace', '~/x')).toBe('~/x')
    expect(resolveSandboxPath('/workspace', 'out/report.csv')).toBe('/workspace/out/report.csv')
    expect(resolveSandboxPath('', 'a')).toBe('./a')
  })
})

describe('parseListOutput', () => {
  it('parses cwd + entries, dirs first, strips trailing slash', () => {
    const out = `${LS_PWD_MARK} /workspace\nnode_modules/\nREADME.md\nout/\n.env\n`
    const r = parseListOutput(out)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cwd).toBe('/workspace')
    expect(r.entries).toEqual([
      { name: 'node_modules', isDir: true },
      { name: 'out', isDir: true },
      { name: '.env', isDir: false },
      { name: 'README.md', isDir: false }
    ])
  })
  it('returns an error result on the error sentinel', () => {
    expect(parseListOutput(`${LS_ERR_MARK}\n`)).toEqual({ ok: false, error: expect.any(String) })
  })
})
