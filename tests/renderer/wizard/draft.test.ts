import { describe, it, expect } from 'vitest'
import { initialDraft, draftReducer, resolveBaseImage, parsePort, canAdvance, toSpec } from '../../../src/renderer/wizard/draft'

describe('parsePort', () => {
  it('parses host:container', () => { expect(parsePort('8080:3000')).toEqual({ hostPort: 8080, containerPort: 3000 }) })
  it('rejects malformed input', () => {
    expect(parsePort('8080')).toBeNull()
    expect(parsePort('a:b')).toBeNull()
    expect(parsePort('')).toBeNull()
  })
})

describe('resolveBaseImage', () => {
  it('maps a builtin variant to a template ref', () => {
    expect(resolveBaseImage({ ...initialDraft, imageChoice: 'claude-code-docker' })).toBe('docker.io/docker/sandbox-templates:claude-code-docker')
  })
  it('uses the custom ref verbatim when custom is chosen', () => {
    expect(resolveBaseImage({ ...initialDraft, imageChoice: 'custom', customImageRef: 'docker.io/acme/img:1' })).toBe('docker.io/acme/img:1')
  })
})

describe('canAdvance', () => {
  it('blocks step 1 without a name', () => {
    expect(canAdvance({ ...initialDraft, step: 1, name: '' })).toBe(false)
    expect(canAdvance({ ...initialDraft, step: 1, name: 'x' })).toBe(true)
  })
  it('blocks step 3 without a workspace', () => {
    expect(canAdvance({ ...initialDraft, step: 3, workspace: '' })).toBe(false)
    expect(canAdvance({ ...initialDraft, step: 3, workspace: '/w' })).toBe(true)
  })
})

describe('draftReducer', () => {
  it('advances and retreats steps', () => {
    let d = { ...initialDraft, name: 'x' }
    d = draftReducer(d, { type: 'next' })
    expect(d.step).toBe(2)
    d = draftReducer(d, { type: 'back' })
    expect(d.step).toBe(1)
  })
  it('does not advance past the last step or before the first', () => {
    expect(draftReducer({ ...initialDraft, step: 7 }, { type: 'next' }).step).toBe(7)
    expect(draftReducer({ ...initialDraft, step: 1 }, { type: 'back' }).step).toBe(1)
  })
  it('adds and removes domains', () => {
    let d = draftReducer(initialDraft, { type: 'addDomain', host: 'api.github.com' })
    expect(d.domains).toEqual(['api.github.com'])
    d = draftReducer(d, { type: 'addDomain', host: 'api.github.com' }) // dedupe
    expect(d.domains).toEqual(['api.github.com'])
    d = draftReducer(d, { type: 'removeDomain', host: 'api.github.com' })
    expect(d.domains).toEqual([])
  })
  it('adds and removes ports and credentials', () => {
    let d = draftReducer(initialDraft, { type: 'addPort', hostPort: 8080, containerPort: 3000, label: 'web' })
    expect(d.ports).toHaveLength(1)
    d = draftReducer(d, { type: 'removePort', index: 0 })
    expect(d.ports).toHaveLength(0)
    d = draftReducer(d, { type: 'addCredential', label: 'gh', kind: 'git' })
    expect(d.credentials).toEqual([{ label: 'gh', kind: 'git' }])
  })
  it('adds and removes extra folders', () => {
    let d = draftReducer(initialDraft, { type: 'addExtraFolder', path: '/lib', mode: 'clone' })
    expect(d.extraFolders).toEqual([{ path: '/lib', mode: 'clone' }])
    d = draftReducer(d, { type: 'removeExtraFolder', index: 0 })
    expect(d.extraFolders).toEqual([])
  })
})

describe('toSpec', () => {
  it('builds a DefinitionSpec with the workspace as the primary mount', () => {
    const d = {
      ...initialDraft, name: 'alpha', description: 'a', imageChoice: 'claude-code-docker' as const,
      workspace: '/home/u/alpha', workspaceMode: 'direct' as const,
      extraFolders: [{ path: '/home/u/lib', mode: 'clone' as const }],
      tier: 'locked' as const, domains: ['api.github.com'],
      ports: [{ hostPort: 8080, containerPort: 3000, label: 'web' }],
      credentials: [{ label: 'gh', kind: 'git' as const }]
    }
    const spec = toSpec(d, 'id1', '2026-07-18T00:00:00Z')
    expect(spec.definition).toEqual({ id: 'id1', name: 'alpha', description: 'a', baseImage: 'docker.io/docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
    expect(spec.mounts).toEqual([
      { hostPath: '/home/u/alpha', mode: 'direct', isPrimary: true },
      { hostPath: '/home/u/lib', mode: 'clone', isPrimary: false }
    ])
    expect(spec.domains).toEqual(['api.github.com'])
    expect(spec.ports).toEqual([{ hostPort: 8080, containerPort: 3000, label: 'web' }])
    expect(spec.credentials).toEqual([{ label: 'gh', kind: 'git' }])
  })
})
