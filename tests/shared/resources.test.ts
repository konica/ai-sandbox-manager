import { describe, it, expect } from 'vitest'
import { isValidCpus, isValidMemory, parseCpus, parseMemory } from '@shared/resources'

describe('isValidCpus', () => {
  it('accepts empty (= sbx default) and positive integers', () => {
    for (const s of ['', '  ', '1', '4', '16']) expect(isValidCpus(s)).toBe(true)
  })
  it('rejects zero, negatives, decimals, and non-numbers', () => {
    for (const s of ['0', '-1', '2.5', 'abc', '4 cpus']) expect(isValidCpus(s)).toBe(false)
  })
  it('honors an optional host maximum', () => {
    expect(isValidCpus('4', 8)).toBe(true)   // below max
    expect(isValidCpus('8', 8)).toBe(true)   // at max
    expect(isValidCpus('9', 8)).toBe(false)  // above max
    expect(isValidCpus('', 8)).toBe(true)    // empty = default, still valid
  })
  it('ignores a non-positive or missing max (structural only)', () => {
    expect(isValidCpus('999')).toBe(true)    // no max
    expect(isValidCpus('999', 0)).toBe(true) // 0 = unknown → no bound
    expect(isValidCpus('999', -1)).toBe(true)
  })
})

describe('isValidMemory', () => {
  it('accepts empty and binary-unit sizes', () => {
    for (const s of ['', '1024m', '8g', '512M', '2G', '1.5g']) expect(isValidMemory(s)).toBe(true)
  })
  it('rejects unitless numbers and junk', () => {
    for (const s of ['1024', '8gb', 'g', 'abc', '8 g x']) expect(isValidMemory(s)).toBe(false)
  })
})

describe('parseCpus', () => {
  it('returns the integer when valid, undefined otherwise', () => {
    expect(parseCpus('4')).toBe(4)
    expect(parseCpus('')).toBeUndefined()
    expect(parseCpus('0')).toBeUndefined()
    expect(parseCpus('2.5')).toBeUndefined()
  })
})

describe('parseMemory', () => {
  it('normalizes unit to lowercase and strips spaces, else undefined', () => {
    expect(parseMemory('8G')).toBe('8g')
    expect(parseMemory('1024 m')).toBe('1024m')
    expect(parseMemory('')).toBeUndefined()
    expect(parseMemory('1024')).toBeUndefined()
  })
})
