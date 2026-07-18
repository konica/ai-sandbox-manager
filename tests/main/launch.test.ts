import { describe, it, expect, vi } from 'vitest'
import { launchDefinition } from '../../src/main/launch'
import type { DefinitionSpec, InstanceMeta, SbxInstance } from '../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: ['api.example.com'],
  ports: [{ hostPort: 3000, containerPort: 8080, label: 'web' }],
  credentials: []
}

function deps(getSpec: () => DefinitionSpec | undefined, live: string[] = [], metaNames: string[] = []) {
  const metas: InstanceMeta[] = metaNames.map((n) => ({ sbxName: n, definitionId: null, createdByApp: true, createdAt: 't' }))
  const infos: string[] = []
  const store = {
    getDefinitionSpec: vi.fn(getSpec),
    upsertInstanceMeta: vi.fn((m: InstanceMeta) => { metas.push(m) }),
    listInstanceMeta: vi.fn(() => metas)
  } as never
  const adapter = {
    listSandboxes: vi.fn(async (): Promise<SbxInstance[]> => live.map((n) => ({ name: n, status: 'running', agent: 'claude', ports: [], workspace: null })))
  }
  const openTerminal = vi.fn()
  const log = { info: (m: string) => infos.push(m), command: () => {}, error: () => {} }
  return { adapter, store, openTerminal, log, metas, infos }
}

describe('launchDefinition', () => {
  it('opens a terminal running the full sbx chain and records metadata', async () => {
    const d = deps(() => spec)
    const res = await launchDefinition(d as never, 'd1')
    expect(res.name).toBe('my-project')

    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain('sbx create claude /p --name my-project --template img:tag')
    expect(cmd).toContain('sbx policy allow network --sandbox my-project api.example.com')
    expect(cmd).toContain('sbx ports my-project --publish 3000:8080')
    expect(cmd).toMatch(/&& sbx run --name my-project$/)

    expect(d.metas[0]).toMatchObject({ sbxName: 'my-project', definitionId: 'd1', createdByApp: true })
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
    expect(d.infos.some((l) => /Launching "my-project"/.test(l))).toBe(true)
    expect(d.infos.some((l) => /terminal/i.test(l))).toBe(true)
  })
})
