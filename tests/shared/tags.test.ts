import { describe, it, expect } from 'vitest'
import { normalizeTags, MAX_TAGS } from '../../src/shared/tags'

describe('normalizeTags', () => {
  it('trims and drops empty/whitespace tags', () => {
    expect(normalizeTags([' prod ', '', '   ', 'eu'])).toEqual(['prod', 'eu'])
  })
  it('dedupes case-insensitively, keeping first casing', () => {
    expect(normalizeTags(['Prod', 'prod', 'PROD'])).toEqual(['Prod'])
  })
  it('truncates each tag to 32 chars', () => {
    const long = 'x'.repeat(40)
    expect(normalizeTags([long])).toEqual(['x'.repeat(32)])
  })
  it('caps the number of tags at MAX_TAGS', () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `t${i}`)
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS)
  })
})
