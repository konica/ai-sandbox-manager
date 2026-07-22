import { describe, it, expect } from 'vitest'
import { mergePaths } from '../../src/main/env-path'

describe('mergePaths', () => {
  it('prepends login PATH entries ahead of the current PATH and de-dupes', () => {
    expect(mergePaths('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin')).toBe('/opt/homebrew/bin:/usr/bin:/bin')
  })
  it('keeps current-only entries that the login PATH lacks', () => {
    expect(mergePaths('/opt/homebrew/bin', '/usr/bin:/bin')).toBe('/opt/homebrew/bin:/usr/bin:/bin')
  })
  it('tolerates missing values and empty segments', () => {
    expect(mergePaths(undefined, '/usr/bin')).toBe('/usr/bin')
    expect(mergePaths('/opt/homebrew/bin', undefined)).toBe('/opt/homebrew/bin')
    expect(mergePaths('/opt/homebrew/bin::', ':/usr/bin')).toBe('/opt/homebrew/bin:/usr/bin')
    expect(mergePaths(undefined, undefined)).toBe('')
  })
})
