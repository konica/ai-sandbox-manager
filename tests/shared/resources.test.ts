import { describe, it, expect } from 'vitest'
import { isValidCpus, isValidMemory, parseCpus, parseMemory, isValidDiskSize, parseDiskSize } from '@shared/resources'

describe('isValidCpus', () => {
  it('accepts empty (= sbx default) and positive integers', () => {
    for (const s of ['', '  ', '1', '4', '16']) expect(isValidCpus(s)).toBe(true)
  })
  it('rejects zero, negatives, decimals, and non-numbers', () => {
    for (const s of ['0', '-1', '2.5', 'abc', '4 cpus']) expect(isValidCpus(s)).toBe(false)
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

describe('isValidDiskSize', () => {
  it('accepts empty (= Docker default) and binary-unit sizes', () => {
    for (const s of ['', '  ', '50g', '512m', '2G', '1.5g']) expect(isValidDiskSize(s)).toBe(true)
  })
  it('rejects unitless numbers and junk', () => {
    for (const s of ['50', '10gb', 'g', 'abc', '50 g x']) expect(isValidDiskSize(s)).toBe(false)
  })
})

describe('parseDiskSize', () => {
  it('normalizes unit to lowercase and strips spaces, else undefined', () => {
    expect(parseDiskSize('50G')).toBe('50g')
    expect(parseDiskSize('512 m')).toBe('512m')
    expect(parseDiskSize('')).toBeUndefined()
    expect(parseDiskSize('50')).toBeUndefined()
  })
})
