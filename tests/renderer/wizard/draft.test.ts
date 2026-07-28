import { describe, it, expect } from 'vitest'
import { initialDraft, draftReducer, resolveBaseImage, parsePort, canAdvance, toSpec, draftFromSpec, basename, effectiveName, needsProviderDomainHint } from '../../../src/renderer/wizard/draft'
import type { DefinitionSpec } from '../../../src/shared/types'

const storedSpec: DefinitionSpec = {
  definition: { id: 'd1', name: 'Proj', description: 'desc', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'balanced', createdAt: 't' },
  mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }, { hostPath: '/docs', mode: 'clone', isPrimary: false }],
  domains: ['a.com'],
  ports: [{ hostPort: 3000, containerPort: 8080, protocol: 'tcp', label: 'web' }],
  hostServices: [], credentials: [{ kind: 'service', serviceId: 'github', envVar: 'GH_TOKEN', store: 'sbx' }]
}

describe('draftFromSpec', () => {
  it('seeds the wizard draft from a stored spec (known image)', () => {
    const d = draftFromSpec(storedSpec)
    expect(d).toMatchObject({
      name: 'Proj', description: 'desc', imageChoice: 'claude-code', customImageRef: '',
      workspace: '/w', tier: 'balanced', domains: ['a.com']
    })
    expect(d.extraFolders).toEqual([{ path: '/docs', mode: 'clone' }])
    expect(d.ports).toEqual([{ hostPort: 3000, containerPort: 8080, protocol: 'tcp', label: 'web' }])
    expect(d.credentials).toEqual([{ kind: 'service', serviceId: 'github', envVar: 'GH_TOKEN', value: '' }])
  })
  it('maps an unknown base image to the custom choice', () => {
    const d = draftFromSpec({ ...storedSpec, definition: { ...storedSpec.definition, baseImage: 'my/custom:tag' } })
    expect(d.imageChoice).toBe('custom')
    expect(d.customImageRef).toBe('my/custom:tag')
  })
  it('round-trips through toSpec preserving id and createdAt', () => {
    const back = toSpec(draftFromSpec(storedSpec), 'd1', 't')
    expect(back.definition).toMatchObject({ id: 'd1', name: 'Proj', tier: 'balanced', createdAt: 't' })
    expect(back.domains).toEqual(['a.com'])
  })
})

describe('basename / effectiveName', () => {
  it('takes the last path segment, tolerating trailing slashes', () => {
    expect(basename('/home/u/my-project')).toBe('my-project')
    expect(basename('/home/u/my-project/')).toBe('my-project')
    expect(basename('~/projects/alpha')).toBe('alpha')
  })
  it('uses the entered name when present, else the workspace basename', () => {
    expect(effectiveName({ ...initialDraft, name: 'custom', workspace: '/home/u/proj' })).toBe('custom')
    expect(effectiveName({ ...initialDraft, name: '', workspace: '/home/u/proj' })).toBe('proj')
  })
})

describe('parsePort', () => {
  it('parses host:container', () => { expect(parsePort('8080:3000')).toEqual({ hostPort: 8080, containerPort: 3000 }) })
  it('parses a bare port as ephemeral (null host port)', () => { expect(parsePort('8080')).toEqual({ hostPort: null, containerPort: 8080 }) })
  it('rejects malformed input', () => {
    expect(parsePort('a:b')).toBeNull()
    expect(parsePort('')).toBeNull()
  })
})

describe('resolveBaseImage', () => {
  it('maps a builtin variant to a template ref', () => {
    expect(resolveBaseImage({ ...initialDraft, imageChoice: 'claude-code' })).toBe('docker.io/docker/sandbox-templates:claude-code')
  })
  it('maps the claude-code-docker variant to its template ref (and round-trips)', () => {
    expect(resolveBaseImage({ ...initialDraft, imageChoice: 'claude-code-docker' })).toBe('docker.io/docker/sandbox-templates:claude-code-docker')
    const d = draftFromSpec({ ...storedSpec, definition: { ...storedSpec.definition, baseImage: 'docker.io/docker/sandbox-templates:claude-code-docker' } })
    expect(d.imageChoice).toBe('claude-code-docker')
  })
  it('uses the custom ref verbatim when custom is chosen', () => {
    expect(resolveBaseImage({ ...initialDraft, imageChoice: 'custom', customImageRef: 'docker.io/acme/img:1' })).toBe('docker.io/acme/img:1')
  })
})

describe('canAdvance', () => {
  it('blocks step 1 until a working directory is set (name is optional)', () => {
    expect(canAdvance({ ...initialDraft, step: 1, workspace: '', name: 'x' })).toBe(false)
    expect(canAdvance({ ...initialDraft, step: 1, workspace: '/w', name: '' })).toBe(true)
  })
  it('allows advancing past later informational steps', () => {
    expect(canAdvance({ ...initialDraft, step: 3 })).toBe(true)
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
    let d = draftReducer(initialDraft, { type: 'addPort', hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: 'web' })
    expect(d.ports).toHaveLength(1)
    d = draftReducer(d, { type: 'removePort', index: 0 })
    expect(d.ports).toHaveLength(0)
    d = draftReducer(d, { type: 'addServiceCred', serviceId: 'github', envVar: 'GH_TOKEN', value: 'gho_x' })
    expect(d.credentials).toEqual([{ kind: 'service', serviceId: 'github', envVar: 'GH_TOKEN', value: 'gho_x' }])
  })
  it('adds and removes extra folders', () => {
    let d = draftReducer(initialDraft, { type: 'addExtraFolder', path: '/lib', mode: 'clone' })
    expect(d.extraFolders).toEqual([{ path: '/lib', mode: 'clone' }])
    d = draftReducer(d, { type: 'removeExtraFolder', index: 0 })
    expect(d.extraFolders).toEqual([])
  })
  it('changes an extra folder access mode (read-only ⇄ read-write)', () => {
    let d = draftReducer(initialDraft, { type: 'addExtraFolder', path: '/lib', mode: 'clone' })
    d = draftReducer(d, { type: 'setExtraFolderMode', index: 0, mode: 'direct' })
    expect(d.extraFolders).toEqual([{ path: '/lib', mode: 'direct' }])
    // toSpec carries the chosen access into the mount (direct = read-write, clone = read-only)
    const spec = toSpec({ ...d, workspace: '/w', name: 'p' }, 'id', 't')
    expect(spec.mounts).toContainEqual({ hostPath: '/lib', mode: 'direct', isPrimary: false })
  })
})

describe('kitCommandsYaml', () => {
  it('round-trips kitCommandsYaml through toSpec/draftFromSpec', () => {
    const d = { ...initialDraft, workspace: '/w', name: 'p', kitCommandsYaml: 'commands:\n  install: echo hi\n' }
    const spec = toSpec(d, 'id', 't')
    expect(spec.kitCommandsYaml).toBe('commands:\n  install: echo hi\n')
    expect(draftFromSpec(spec).kitCommandsYaml).toBe('commands:\n  install: echo hi\n')
  })
  it('omits kitCommandsYaml from the spec when blank', () => {
    const spec = toSpec({ ...initialDraft, workspace: '/w', name: 'p', kitCommandsYaml: '   ' }, 'id', 't')
    expect(spec.kitCommandsYaml).toBeUndefined()
  })
})

describe('toSpec', () => {
  it('builds a DefinitionSpec with the workspace as the primary mount', () => {
    const d = {
      ...initialDraft, name: 'alpha', description: 'a', imageChoice: 'claude-code' as const,
      workspace: '/home/u/alpha',
      extraFolders: [{ path: '/home/u/lib', mode: 'clone' as const }],
      tier: 'locked' as const, domains: ['api.github.com'],
      ports: [{ hostPort: 8080, containerPort: 3000, protocol: 'tcp' as const, label: 'web' }],
      hostServices: [], credentials: [{ kind: 'service' as const, serviceId: 'github', envVar: 'GH_TOKEN', value: 'gho_x' }]
    }
    const spec = toSpec(d, 'id1', '2026-07-18T00:00:00Z')
    expect(spec.definition).toEqual({ id: 'id1', name: 'alpha', description: 'a', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
    expect(spec.mounts).toEqual([
      { hostPath: '/home/u/alpha', mode: 'direct', isPrimary: true },
      { hostPath: '/home/u/lib', mode: 'clone', isPrimary: false }
    ])
    expect(spec.domains).toEqual(['api.github.com'])
    expect(spec.ports).toEqual([{ hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: 'web' }])
    expect(spec.credentials).toEqual([{ kind: 'service', serviceId: 'github', envVar: 'GH_TOKEN', store: 'sbx' }])
  })
})

describe('agent selection', () => {
  it('setImageChoice auto-derives the agent for a builtin variant', () => {
    let d = draftReducer(initialDraft, { type: 'setImageChoice', value: 'opencode' })
    expect(d.agent).toBe('opencode')
    d = draftReducer(d, { type: 'setImageChoice', value: 'claude-code-docker' })
    expect(d.agent).toBe('claude')
  })
  it('setImageChoice leaves the agent untouched when switching to custom', () => {
    let d = draftReducer(initialDraft, { type: 'setImageChoice', value: 'opencode' })
    d = draftReducer(d, { type: 'setImageChoice', value: 'custom' })
    expect(d.agent).toBe('opencode')
  })
  it('setAgent overrides the agent directly', () => {
    const d = draftReducer(initialDraft, { type: 'setAgent', value: 'codex' })
    expect(d.agent).toBe('codex')
  })
  it('draftFromSpec reads the stored agent back', () => {
    const d = draftFromSpec({ ...storedSpec, definition: { ...storedSpec.definition, agent: 'opencode' } })
    expect(d.agent).toBe('opencode')
  })
  it('draftFromSpec falls back to deriving from baseImage when agent is missing (pre-migration data)', () => {
    const spec = { ...storedSpec, definition: { ...storedSpec.definition, agent: undefined as never, baseImage: 'docker.io/docker/sandbox-templates:opencode' } }
    expect(draftFromSpec(spec).agent).toBe('opencode')
  })
})

describe('needsProviderDomainHint', () => {
  it('is true for locked + opencode + no domains', () => {
    expect(needsProviderDomainHint({ ...initialDraft, agent: 'opencode', tier: 'locked', domains: [] })).toBe(true)
  })
  it('is false once a domain is added', () => {
    expect(needsProviderDomainHint({ ...initialDraft, agent: 'opencode', tier: 'locked', domains: ['api.openai.com'] })).toBe(false)
  })
  it('is false on the balanced tier', () => {
    expect(needsProviderDomainHint({ ...initialDraft, agent: 'opencode', tier: 'balanced', domains: [] })).toBe(false)
  })
  it('is false on the open tier', () => {
    expect(needsProviderDomainHint({ ...initialDraft, agent: 'opencode', tier: 'open', domains: [] })).toBe(false)
  })
  it('is false for claude, which ships its own domains', () => {
    expect(needsProviderDomainHint({ ...initialDraft, agent: 'claude', tier: 'locked', domains: [] })).toBe(false)
  })
})
