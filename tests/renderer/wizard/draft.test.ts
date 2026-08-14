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
    expect(draftReducer({ ...initialDraft, step: 8 }, { type: 'next' }).step).toBe(8)
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
  it('draftFromSpec round-trips a custom baseImage paired with a non-claude agent', () => {
    const spec = { ...storedSpec, definition: { ...storedSpec.definition, agent: 'codex' as const, baseImage: 'my/custom:tag' } }
    const d = draftFromSpec(spec)
    expect(d.imageChoice).toBe('custom')
    expect(d.customImageRef).toBe('my/custom:tag')
    expect(d.agent).toBe('codex')
    const back = toSpec(d, 'd1', 't')
    expect(back.definition.agent).toBe('codex')
    expect(back.definition.baseImage).toBe('my/custom:tag')
  })
})

// FIX 1 regression coverage: selecting "Custom registry image…" used to leave the Agent field
// at its stale/default value no matter what the typed ref actually was, so a custom opencode
// ref launched as `sbx create claude` — the exact bug from the original report. setField on
// customImageRef now auto-seeds the agent from the ref when it matches a known variant suffix,
// while leaving the field alone (anti-clobber) for anything that doesn't match.
describe('custom image ref auto-seeds the agent (anti-clobber)', () => {
  it('seeds opencode from a custom ref ending in a known ":opencode" suffix', () => {
    let d = draftReducer(initialDraft, { type: 'setImageChoice', value: 'custom' })
    d = draftReducer(d, { type: 'setField', field: 'customImageRef', value: 'docker.io/docker/sandbox-templates:opencode' })
    expect(d.agent).toBe('opencode')
  })
  it('seeds codex from a custom ref ending in a known ":codex" suffix', () => {
    let d = draftReducer(initialDraft, { type: 'setImageChoice', value: 'custom' })
    d = draftReducer(d, { type: 'setField', field: 'customImageRef', value: 'docker.io/acme/mirror:codex' })
    expect(d.agent).toBe('codex')
  })
  it('leaves a previously chosen agent untouched for an unrecognized custom ref (no clobber)', () => {
    let d = draftReducer(initialDraft, { type: 'setAgent', value: 'copilot' })
    d = draftReducer(d, { type: 'setImageChoice', value: 'custom' })
    d = draftReducer(d, { type: 'setField', field: 'customImageRef', value: 'my/registry/thing:v2' })
    expect(d.agent).toBe('copilot')
  })
  it('does not overwrite an explicit setAgent override with a later unrelated field edit', () => {
    let d = draftReducer(initialDraft, { type: 'setImageChoice', value: 'custom' })
    d = draftReducer(d, { type: 'setField', field: 'customImageRef', value: 'docker.io/docker/sandbox-templates:opencode' })
    expect(d.agent).toBe('opencode')
    d = draftReducer(d, { type: 'setAgent', value: 'copilot' }) // explicit user override after the auto-seed
    d = draftReducer(d, { type: 'setField', field: 'name', value: 'my-box' }) // unrelated edit must not touch agent
    expect(d.agent).toBe('copilot')
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

describe('cpus and memory fields', () => {
  it('initializes cpus and memory as empty strings', () => {
    expect(initialDraft.cpus).toBe('')
    expect(initialDraft.memory).toBe('')
  })

  it('setField handles cpus input', () => {
    let d = draftReducer(initialDraft, { type: 'setField', field: 'cpus', value: '4' })
    expect(d.cpus).toBe('4')
    d = draftReducer(d, { type: 'setField', field: 'cpus', value: '' })
    expect(d.cpus).toBe('')
  })

  it('setField handles memory input', () => {
    let d = draftReducer(initialDraft, { type: 'setField', field: 'memory', value: '8g' })
    expect(d.memory).toBe('8g')
    d = draftReducer(d, { type: 'setField', field: 'memory', value: '' })
    expect(d.memory).toBe('')
  })

  it('canAdvance step 2 requires valid cpus and memory when set', () => {
    // Valid cpus
    expect(canAdvance({ ...initialDraft, step: 2, cpus: '4', memory: '' })).toBe(true)
    // Valid memory
    expect(canAdvance({ ...initialDraft, step: 2, cpus: '', memory: '8g' })).toBe(true)
    // Both valid
    expect(canAdvance({ ...initialDraft, step: 2, cpus: '4', memory: '8g' })).toBe(true)
    // Both empty (valid)
    expect(canAdvance({ ...initialDraft, step: 2, cpus: '', memory: '' })).toBe(true)
    // Invalid cpus
    expect(canAdvance({ ...initialDraft, step: 2, cpus: 'invalid', memory: '' })).toBe(false)
    // Invalid cpus (zero)
    expect(canAdvance({ ...initialDraft, step: 2, cpus: '0', memory: '' })).toBe(false)
    // Invalid memory
    expect(canAdvance({ ...initialDraft, step: 2, cpus: '', memory: 'invalid' })).toBe(false)
  })

  it('toSpec parses cpus to number and memory to normalized string', () => {
    let spec = toSpec({ ...initialDraft, workspace: '/w', name: 'p', cpus: '4', memory: '' }, 'id', 't')
    expect(spec.definition.cpus).toBe(4)
    expect(spec.definition.memory).toBeUndefined()

    spec = toSpec({ ...initialDraft, workspace: '/w', name: 'p', cpus: '', memory: '8g' }, 'id', 't')
    expect(spec.definition.cpus).toBeUndefined()
    expect(spec.definition.memory).toBe('8g')

    spec = toSpec({ ...initialDraft, workspace: '/w', name: 'p', cpus: '2', memory: '4G' }, 'id', 't')
    expect(spec.definition.cpus).toBe(2)
    expect(spec.definition.memory).toBe('4g')

    spec = toSpec({ ...initialDraft, workspace: '/w', name: 'p', cpus: '', memory: '' }, 'id', 't')
    expect(spec.definition.cpus).toBeUndefined()
    expect(spec.definition.memory).toBeUndefined()
  })

  it('draftFromSpec seeds cpus and memory as strings', () => {
    const spec = { ...storedSpec, definition: { ...storedSpec.definition, cpus: 4, memory: '8g' } }
    const d = draftFromSpec(spec)
    expect(d.cpus).toBe('4')
    expect(d.memory).toBe('8g')
  })

  it('draftFromSpec handles cpus: 0 correctly (null-safe check)', () => {
    const spec = { ...storedSpec, definition: { ...storedSpec.definition, cpus: 0 } }
    const d = draftFromSpec(spec)
    expect(d.cpus).toBe('0')
  })

  it('draftFromSpec seeds cpus and memory as empty strings when undefined', () => {
    const d = draftFromSpec(storedSpec)
    expect(d.cpus).toBe('')
    expect(d.memory).toBe('')
  })

  it('round-trips cpus and memory through toSpec/draftFromSpec', () => {
    let d = { ...initialDraft, workspace: '/w', name: 'p', cpus: '4', memory: '8g' }
    let spec = toSpec(d, 'id', 't')
    expect(spec.definition.cpus).toBe(4)
    expect(spec.definition.memory).toBe('8g')
    let d2 = draftFromSpec(spec)
    expect(d2.cpus).toBe('4')
    expect(d2.memory).toBe('8g')
  })
})
