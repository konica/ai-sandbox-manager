import { describe, it, expect } from 'vitest'
import { SbxError, classifySbxError } from '@shared/errors'

describe('classifySbxError', () => {
  it('detects a missing binary', () => {
    expect(classifySbxError(127, 'sbx: command not found')).toBe('not-installed')
  })
  it('detects an unauthenticated session', () => {
    expect(classifySbxError(1, 'Error: not logged in. Run `sbx login`.')).toBe('not-authed')
  })
  it('detects a missing sandbox', () => {
    expect(classifySbxError(1, 'sandbox "foo" not found')).toBe('not-found')
  })
  it('falls back to generic', () => {
    expect(classifySbxError(2, 'some other failure')).toBe('generic')
  })
})

describe('SbxError', () => {
  it('carries a kind', () => {
    const e = new SbxError('not-authed', 'please log in')
    expect(e.kind).toBe('not-authed')
    expect(e.message).toBe('please log in')
    expect(e).toBeInstanceOf(Error)
  })
})
