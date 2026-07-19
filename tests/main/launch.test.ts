import { describe, it, expect, vi } from 'vitest'
import { launchDefinition } from '../../src/main/launch'
import type { DefinitionSpec, InstanceMeta, SbxInstance } from '../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: ['api.example.com'],
  ports: [{ hostPort: 3000, containerPort: 8080, protocol: 'tcp', label: 'web' }],
  hostServices: [], credentials: []
}

function deps(getSpec: () => DefinitionSpec | undefined, live: string[] = [], metaNames: string[] = []) {
  const metas: InstanceMeta[] = metaNames.map((n) => ({ sbxName: n, definitionId: null, createdByApp: true, createdAt: 't' }))
  const infos: string[] = []
  const store = {
    getDefinitionSpec: vi.fn(getSpec),
    upsertInstanceMeta: vi.fn((m: InstanceMeta) => { metas.push(m) }),
    listInstanceMeta: vi.fn(() => metas)
  } as never
  const setSecret = vi.fn(async () => {})
  const setCustomSecret = vi.fn(async () => {})
  const adapter = {
    listSandboxes: vi.fn(async (): Promise<SbxInstance[]> => live.map((n) => ({ name: n, status: 'running', agent: 'claude', ports: [], workspace: null }))),
    setSecret, setCustomSecret
  }
  const staged: Record<string, string> = {}
  const creds = { getStaged: (k: string) => staged[k] ?? null }
  const materializeKit = vi.fn(() => '/p/.sandbox/kit')
  const openTerminal = vi.fn()
  const log = { info: (m: string) => infos.push(m), command: () => {}, error: () => {} }
  return { adapter, store, creds, materializeKit, openTerminal, log, metas, infos, staged, setSecret, setCustomSecret }
}

describe('launchDefinition', () => {
  it('opens a terminal running the sbx chain with the allowlist kit (no standalone policy step) and records metadata', async () => {
    const d = deps(() => spec)
    const res = await launchDefinition(d as never, 'd1')
    expect(res.name).toBe('my-project')

    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain('sbx create claude /p --name my-project --template img:tag')
    expect(cmd).toContain('--kit /p/.sandbox/kit') // kit owns network policy
    expect(cmd).not.toContain('policy allow network') // …so the standalone step is dropped
    expect(cmd).toContain('sbx ports my-project --publish 3000:8080')
    expect(cmd).toMatch(/&& sbx run --name my-project$/)

    expect(d.metas[0]).toMatchObject({ sbxName: 'my-project', definitionId: 'd1', createdByApp: true })
  })

  it('registers staged secrets sandbox-scoped, BEFORE opening the terminal, and never in the command', async () => {
    const credSpec: DefinitionSpec = {
      ...spec,
      hostServices: [], credentials: [
        { kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' },
        { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }
      ]
    }
    const d = deps(() => credSpec)
    d.staged['d1:service:anthropic'] = 'sk-ant-xyz'
    d.staged['d1:custom:acme'] = 'acme-secret'
    // order guard: secrets must be set before the terminal opens
    const order: string[] = []
    d.setSecret.mockImplementation(async () => { order.push('service') })
    d.setCustomSecret.mockImplementation(async () => { order.push('custom') })
    d.openTerminal.mockImplementation(() => { order.push('terminal') })

    await launchDefinition(d as never, 'd1')

    expect(d.setSecret).toHaveBeenCalledWith('anthropic', 'sk-ant-xyz', { sandbox: 'my-project' })
    expect(d.setCustomSecret).toHaveBeenCalledWith(['api.acme.com'], 'ACME_KEY', 'acme-secret', { sandbox: 'my-project' })
    expect(order).toEqual(['service', 'custom', 'terminal'])
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).not.toContain('sk-ant-xyz')
    expect(cmd).not.toContain('acme-secret')
  })

  it('skips a credential with no staged value and logs a clear warning', async () => {
    const credSpec: DefinitionSpec = { ...spec, hostServices: [], credentials: [{ kind: 'service', serviceId: 'openai', envVar: 'OPENAI_API_KEY', store: 'sbx' }] }
    const d = deps(() => credSpec) // nothing staged
    await launchDefinition(d as never, 'd1')
    expect(d.setSecret).not.toHaveBeenCalled()
    expect(d.infos.some((l) => /no stored value/i.test(l))).toBe(true)
  })

  it('picks a unique name when the base collides with an existing sandbox', async () => {
    const d = deps(() => spec, ['my-project'])
    const res = await launchDefinition(d as never, 'd1')
    expect(res.name).toBe('my-project-2')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain('--name my-project-2')
    expect(cmd).toMatch(/&& sbx run --name my-project-2$/)
    expect(d.metas.some((m) => m.sbxName === 'my-project-2')).toBe(true)
  })

  it('uses a requested name (normalised) instead of deriving from the definition', async () => {
    const d = deps(() => spec)
    const res = await launchDefinition(d as never, 'd1', 'My Custom Session')
    expect(res.name).toBe('my-custom-session')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain('--name my-custom-session')
  })

  it('passes the session name to claude via the run step', async () => {
    const d = deps(() => spec)
    await launchDefinition(d as never, 'd1', undefined, 'My Session')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toMatch(/sbx run --name my-project -- --name 'My Session'$/)
  })

  it('also avoids names already recorded in metadata', async () => {
    const d = deps(() => spec, [], ['my-project', 'my-project-2'])
    const res = await launchDefinition(d as never, 'd1')
    expect(res.name).toBe('my-project-3')
  })

  it('throws not-found when the definition is missing (and opens no terminal)', async () => {
    const d = deps(() => undefined)
    await expect(launchDefinition(d as never, 'nope')).rejects.toThrow(/not found/i)
    expect(d.openTerminal).not.toHaveBeenCalled()
  })

  it('logs launch milestones when a logger is provided', async () => {
    const d = deps(() => spec)
    await launchDefinition(d as never, 'd1')
    expect(d.infos.some((l) => /Launching sandbox "my-project"/.test(l))).toBe(true)
    expect(d.infos.some((l) => /terminal/i.test(l))).toBe(true)
  })
})
