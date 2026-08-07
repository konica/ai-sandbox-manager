import { describe, it, expect } from 'vitest'
import { filesReducer, initialFilesState } from '../../../src/renderer/screens/detail/filesReducer'

describe('filesReducer', () => {
  it('setDirection resets sources, dest, plan, and results', () => {
    let s = filesReducer(initialFilesState, { type: 'addSources', paths: ['/a'] })
    s = filesReducer(s, { type: 'setDest', dest: '/x' })
    s = filesReducer(s, { type: 'setResults', results: [{ source: '/a', ok: true }] })
    s = filesReducer(s, { type: 'setDirection', direction: 'fromSandbox' })
    expect(s.direction).toBe('fromSandbox')
    expect(s.sources).toEqual([])
    expect(s.dest).toBe('')
    expect(s.results).toBeNull()
  })
  it('addSources unions and de-duplicates, and clears a stale plan/results', () => {
    let s = filesReducer(initialFilesState, { type: 'setPlan', plan: { resolvedDest: '/x', items: [] }, confirmOpen: false })
    s = filesReducer(s, { type: 'addSources', paths: ['/a', '/b'] })
    s = filesReducer(s, { type: 'addSources', paths: ['/b', '/c'] })
    expect(s.sources).toEqual(['/a', '/b', '/c'])
    expect(s.plan).toBeNull()
  })
  it('removeSource drops one entry', () => {
    let s = filesReducer(initialFilesState, { type: 'addSources', paths: ['/a', '/b'] })
    s = filesReducer(s, { type: 'removeSource', path: '/a' })
    expect(s.sources).toEqual(['/b'])
  })
  it('browserLoaded stores cwd + entries and clears error/loading', () => {
    let s = filesReducer(initialFilesState, { type: 'browserLoading' })
    expect(s.browser.loading).toBe(true)
    s = filesReducer(s, { type: 'browserLoaded', result: { ok: true, cwd: '/workspace', entries: [{ name: 'out', isDir: true }] } })
    expect(s.browser).toEqual({ cwd: '/workspace', entries: [{ name: 'out', isDir: true }], error: null, loading: false })
  })
  it('browserLoaded with an error result stores the message and clears stale entries', () => {
    let s = filesReducer(initialFilesState, { type: 'browserLoaded', result: { ok: true, cwd: '/w', entries: [{ name: 'a', isDir: false }] } })
    s = filesReducer(s, { type: 'browserLoaded', result: { ok: false, error: 'nope' } })
    expect(s.browser.error).toBe('nope')
    expect(s.browser.loading).toBe(false)
    expect(s.browser.entries).toEqual([])
  })
  it('setPlan opens the confirm only when asked', () => {
    const plan = { resolvedDest: '/x', items: [] }
    expect(filesReducer(initialFilesState, { type: 'setPlan', plan, confirmOpen: true }).confirmOpen).toBe(true)
    expect(filesReducer(initialFilesState, { type: 'setPlan', plan, confirmOpen: false }).confirmOpen).toBe(false)
  })
})
