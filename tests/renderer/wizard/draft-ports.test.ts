import { describe, it, expect } from 'vitest'
import { draftReducer, initialDraft, parsePort, toSpec } from '../../../src/renderer/wizard/draft'

describe('parsePort', () => {
  it('parses explicit host:container', () => { expect(parsePort('8080:3000')).toEqual({ hostPort: 8080, containerPort: 3000 }) })
  it('parses a bare container port as ephemeral', () => { expect(parsePort('3000')).toEqual({ hostPort: null, containerPort: 3000 }) })
  it('rejects junk', () => { expect(parsePort('nope')).toBeNull() })
})

describe('draft ports + host services', () => {
  const base = { ...initialDraft, workspace: '/p', name: 'p' }
  it('adds an ephemeral tcp6 port', () => {
    const d = draftReducer(base, { type: 'addPort', hostPort: null, containerPort: 9229, protocol: 'tcp6', label: 'dbg' })
    expect(d.ports[0]).toEqual({ hostPort: null, containerPort: 9229, protocol: 'tcp6', label: 'dbg' })
  })
  it('adds and removes a host service, and maps to spec', () => {
    let d = draftReducer(base, { type: 'addHostService', hostPort: 11434, label: 'Ollama' })
    expect(d.hostServices).toEqual([{ hostPort: 11434, label: 'Ollama' }])
    const spec = toSpec(d, 'id1', '2026-07-19T00:00:00.000Z')
    expect(spec.hostServices).toEqual([{ hostPort: 11434, label: 'Ollama' }])
    d = draftReducer(d, { type: 'removeHostService', index: 0 })
    expect(d.hostServices).toEqual([])
  })
})
