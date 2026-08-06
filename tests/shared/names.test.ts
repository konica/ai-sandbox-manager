import { describe, it, expect } from 'vitest'
import { composeInstanceBaseName } from '../../src/shared/names'

describe('composeInstanceBaseName', () => {
  it('slugifies the definition name when there are no tags', () => {
    expect(composeInstanceBaseName('My Proj', [])).toBe('my-proj')
  })
  it('appends slugified tags in entry order', () => {
    expect(composeInstanceBaseName('My Proj', ['prod', 'eu'])).toBe('my-proj-prod-eu')
  })
  it('slugifies tags (lowercase, non-alphanumerics to hyphens)', () => {
    expect(composeInstanceBaseName('proj', ['EU West'])).toBe('proj-eu-west')
  })
  it('stops appending at the first tag that would exceed the length budget', () => {
    // budget 12: "proj" (4) + "-aaaa" (5) = 9 ok; next "-bbbbb" (6) => 15 > 12 => stop
    expect(composeInstanceBaseName('proj', ['aaaa', 'bbbbb', 'c'], 12)).toBe('proj-aaaa')
  })
  it('skips a tag with no alphanumeric characters', () => {
    expect(composeInstanceBaseName('proj', ['!!!', 'eu'])).toBe('proj-eu')
  })
})
