import { describe, it, expect } from 'vitest'
import {
  shellSingleQuote, listDirScript, statScript, existsScript, parseStat, parseExists
} from '../../../src/main/sbx/fs-probe'
import { LS_PWD_MARK, LS_ERR_MARK } from '../../../src/shared/copy'

describe('shellSingleQuote', () => {
  it('wraps in single quotes and escapes embedded single quotes', () => {
    expect(shellSingleQuote('/a/b')).toBe(`'/a/b'`)
    expect(shellSingleQuote("it's")).toBe(`'it'\\''s'`)
  })
})

describe('listDirScript', () => {
  it('cd + prints pwd marker then ls, error sentinel on failure', () => {
    const s = listDirScript('/work space')
    expect(s).toContain(`cd -- '/work space'`)
    expect(s).toContain(`echo "${LS_PWD_MARK} $(pwd)"`)
    expect(s).toContain('ls -1Ap')
    expect(s).toContain(`echo '${LS_ERR_MARK}'`)
  })
})

describe('statScript', () => {
  it('prints dir/file/missing', () => {
    const s = statScript('/x')
    expect(s).toContain(`[ -d '/x' ]`)
    expect(s).toContain(`[ -e '/x' ]`)
  })
})

describe('existsScript / parseExists', () => {
  it('emits one 1/0 line per path in order', () => {
    expect(existsScript([])).toBe('true')
    const s = existsScript(['/a', '/b'])
    expect(s).toContain(`[ -e '/a' ]`)
    expect(parseExists('1\n0\n', 2)).toEqual([true, false])
    expect(parseExists('', 2)).toEqual([false, false])
  })
})

describe('parseStat', () => {
  it('maps output, defaults to missing', () => {
    expect(parseStat('dir\n')).toBe('dir')
    expect(parseStat('file')).toBe('file')
    expect(parseStat('whatever')).toBe('missing')
  })
})
