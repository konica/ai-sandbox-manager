import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'
import type { DefinitionSpec } from '../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: []
}

function deps() {
  const openTerminal = vi.fn()
  const adapter = {
    runSbx: vi.fn(), listSandboxes: vi.fn(async () => []),
    createSandbox: vi.fn(), applyPolicy: vi.fn(), publishPorts: vi.fn(),
    stopSandbox: vi.fn(async () => {}), removeSandbox: vi.fn(async () => {}),
    setSecret: vi.fn(async () => {}), setCustomSecret: vi.fn(async () => {}), setRegistrySecret: vi.fn(async () => {}),
    removeSecret: vi.fn(async () => {}), removeCustomSecret: vi.fn(async () => {}),
    listPorts: vi.fn(async () => []), publishPort: vi.fn(async () => {}), unpublishPort: vi.fn(async () => {}),
    allowNetwork: vi.fn(async () => {}), removeNetwork: vi.fn(async () => {}),
    policyLog: vi.fn(async () => ({ allowed: 0, blocked: 0, events: [] })),
    checkDockerAuth: vi.fn(async () => 'pass'),
    validateKit: vi.fn(async () => ({ code: 0, out: 'ok', ran: true })),
    execScript: vi.fn(async () => {}),
    listInstanceSecretsRaw: vi.fn(async (_name: string) => 'CUSTOM SECRETS\nSCOPE   TARGETS        ENV        PLACEHOLDER          SECRET\nsbx-1   api.acme.com   ACME_KEY   sbx-cs-lifecycle01   GIx*****...*****i2cm\n')
  }
  const store = {
    getDefinitionSpec: vi.fn(() => spec),
    getDefinition: vi.fn(() => spec.definition),
    listDefinitions: vi.fn(() => []),
    upsertInstanceMeta: vi.fn(),
    deleteInstanceMeta: vi.fn(),
    listInstanceMeta: vi.fn(() => []),
    updateInstanceFingerprint: vi.fn(),
    setInstanceTags: vi.fn(),
    listInstanceTags: vi.fn(() => new Map())
  }
  const creds = { getStaged: vi.fn(() => 'secret-val') }
  const probes = {} as never
  const cleanupKit = vi.fn()
  return { adapter, store, creds, probes, openTerminal, cleanupKit, genHash: () => '3323dc52' }
}

describe('instance lifecycle IPC', () => {
  it('instance:launch opens a terminal running the sbx chain and returns the name', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    const r = await h['instance:launch']('d1')
    expect(r).toEqual({ ok: true, data: { name: 'my-project-3323dc52' } })
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain('sbx create claude')
    expect(cmd).toMatch(/sbx run --name my-project-3323dc52$/)
  })

  it('instance:attach and instance:shell open a terminal with the right command', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    await h['instance:attach']('my-project')
    await h['instance:shell']('my-project')
    expect(d.openTerminal).toHaveBeenNthCalledWith(1, "sbx run --name 'my-project' -- --continue")
    expect(d.openTerminal).toHaveBeenNthCalledWith(2, "sbx exec -it 'my-project' bash")
  })

  it('instance:attach re-registers the definition\'s current credentials scoped to the instance (picks up creds added since launch)', async () => {
    const d = deps()
    d.store.listInstanceMeta.mockReturnValue([{ sbxName: 'my-project-x', definitionId: 'd1', createdByApp: true, createdAt: 't' }] as never)
    d.store.getDefinitionSpec.mockReturnValue({
      ...spec, hostServices: [],
      credentials: [{ kind: 'custom', id: 'dock', label: 'Docker', envVar: 'DOCKER_REGISTRY_AUTH_TOKEN', domains: ['dockerregistry.mgm-tp.com'], store: 'encrypted' }]
    } as never)
    const h = buildHandlers(d as never)
    await h['instance:attach']('my-project-x')
    expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['dockerregistry.mgm-tp.com'], 'DOCKER_REGISTRY_AUTH_TOKEN', 'secret-val', { sandbox: 'my-project-x' })
    expect(d.openTerminal).toHaveBeenCalledWith("sbx run --name 'my-project-x' -- --continue")
  })

  it('instance:rebuild removes the old sandbox and relaunches a fresh one from the definition', async () => {
    const d = deps()
    d.store.listInstanceMeta.mockReturnValue([{ sbxName: 'my-project-old', definitionId: 'd1', createdByApp: true, createdAt: 't' }] as never)
    const h = buildHandlers(d as never)
    const r = await h['instance:rebuild']('my-project-old')
    expect(d.adapter.removeSandbox).toHaveBeenCalledWith('my-project-old') // old sandbox torn down
    expect(r).toEqual({ ok: true, data: { name: 'my-project-3323dc52' } }) // fresh instance launched
    expect(d.openTerminal).toHaveBeenCalled()
  })

  it('instance:rebuild fails cleanly when the instance has no linked definition', async () => {
    const d = deps()
    d.store.listInstanceMeta.mockReturnValue([{ sbxName: 'orphan', definitionId: null, createdByApp: true, createdAt: 't' }] as never)
    const h = buildHandlers(d as never)
    const r = await h['instance:rebuild']('orphan')
    expect(r.ok).toBe(false)
    expect(d.adapter.removeSandbox).not.toHaveBeenCalled()
  })

  // A sandbox started outside the app (e.g. from the sbx CLI) has no instance_meta row.
  // The reconciler auto-links it to a definition by workspace path for display; the action
  // handlers must resolve it the same way, or the (now-enabled) buttons fail.
  const cliSpec: DefinitionSpec = {
    ...spec,
    definition: { ...spec.definition, id: 'dws', name: 'work_sample' },
    mounts: [{ hostPath: 'C:\\Data\\Projects\\ERRIA\\work_sample', mode: 'direct', isPrimary: true }]
  }
  function cliInstanceDeps() {
    const d = deps()
    d.store.listInstanceMeta.mockReturnValue([] as never) // no app metadata
    d.store.listDefinitions.mockReturnValue([cliSpec.definition] as never)
    d.store.getDefinitionSpec.mockReturnValue(cliSpec as never)
    d.adapter.listSandboxes.mockResolvedValue([
      { name: 'work-sample-0ce2cb7a', status: 'running', agent: 'claude', ports: [], workspace: 'C:\\Data\\Projects\\ERRIA\\work_sample' }
    ] as never)
    return d
  }

  it('instance:attach opens VS Code for a CLI-created instance auto-linked by workspace path', async () => {
    const d = cliInstanceDeps() as ReturnType<typeof deps> & { openVSCode: ReturnType<typeof vi.fn> }
    d.openVSCode = vi.fn()
    const h = buildHandlers(d as never)
    const r = await h['instance:attach']('work-sample-0ce2cb7a', 'vscode')
    expect(r.ok).toBe(true)
    expect(d.openVSCode).toHaveBeenCalledWith(expect.any(String), 'C:\\Data\\Projects\\ERRIA\\work_sample', 'work-sample-0ce2cb7a')
  })

  it('instance:rebuild rebuilds a CLI-created instance auto-linked by workspace path', async () => {
    const d = cliInstanceDeps()
    const h = buildHandlers(d as never)
    const r = await h['instance:rebuild']('work-sample-0ce2cb7a')
    expect(r.ok).toBe(true)
    expect(d.adapter.removeSandbox).toHaveBeenCalledWith('work-sample-0ce2cb7a')
    expect(d.openTerminal).toHaveBeenCalled()
  })

  it('instance:stop calls the adapter', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    const r = await h['instance:stop']('my-project')
    expect(r.ok).toBe(true)
    expect(d.adapter.stopSandbox).toHaveBeenCalledWith('my-project')
  })

  it('instance:remove removes the sandbox and forgets its metadata', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    const r = await h['instance:remove']('my-project')
    expect(r.ok).toBe(true)
    expect(d.adapter.removeSandbox).toHaveBeenCalledWith('my-project')
    expect(d.store.deleteInstanceMeta).toHaveBeenCalledWith('my-project')
  })

  it('instance:remove also cleans up the instance\'s scoped secrets (not auto-removed by sbx)', async () => {
    const d = deps()
    d.store.listInstanceMeta.mockReturnValue([{ sbxName: 'my-project', definitionId: 'd1', createdByApp: true, createdAt: 't' }] as never)
    d.store.getDefinitionSpec.mockReturnValue({
      ...spec,
      hostServices: [],
      credentials: [
        { kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' },
        { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }
      ]
    } as never)
    const h = buildHandlers(d as never)
    await h['instance:remove']('my-project')
    expect(d.adapter.removeSecret).toHaveBeenCalledWith('anthropic', { sandbox: 'my-project' })
    expect(d.adapter.removeCustomSecret).toHaveBeenCalledWith(['api.acme.com'], { sandbox: 'my-project' })
    expect(d.store.deleteInstanceMeta).toHaveBeenCalledWith('my-project')
  })

  it('instance:remove deletes the workspace .sandbox dir (re-created at next launch)', async () => {
    const d = deps()
    d.store.listInstanceMeta.mockReturnValue([{ sbxName: 'my-project', definitionId: 'd1', createdByApp: true, createdAt: 't' }] as never)
    d.store.getDefinitionSpec.mockReturnValue(spec as never) // primary mount hostPath: '/p'
    const h = buildHandlers(d as never)
    await h['instance:remove']('my-project')
    expect(d.cleanupKit).toHaveBeenCalledWith('/p')
  })

  it('instance:applyCredentials registers creds, injects the persistent-env script, and clears drift', async () => {
    const d = deps()
    d.store.listInstanceMeta.mockReturnValue([{ sbxName: 'sbx-1', definitionId: 'd1', createdByApp: true, createdAt: 't', credFingerprint: 'stale' }] as never)
    d.store.getDefinitionSpec.mockReturnValue({
      ...spec, hostServices: [],
      credentials: [{ kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }]
    } as never)
    d.adapter.listSandboxes.mockResolvedValue([{ name: 'sbx-1', status: 'running', agent: 'claude', ports: [], workspace: '/p' }] as never)
    const h = buildHandlers(d as never)
    const r = await h['instance:applyCredentials']('sbx-1')
    expect(r).toEqual({ ok: true, data: { applied: 1, removed: 0, skipped: 0 } })
    expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['api.acme.com'], 'ACME_KEY', 'secret-val', { sandbox: 'sbx-1' })
    expect(d.adapter.execScript).toHaveBeenCalledWith('sbx-1', expect.stringContaining("export ACME_KEY='sbx-cs-lifecycle01'"))
    expect(d.store.updateInstanceFingerprint).toHaveBeenCalledWith('sbx-1', expect.any(String))
  })

  it('instance:applyCredentials fails cleanly when the instance has no linked definition', async () => {
    const d = deps()
    d.store.listInstanceMeta.mockReturnValue([{ sbxName: 'orphan', definitionId: null, createdByApp: true, createdAt: 't' }] as never)
    d.adapter.listSandboxes.mockResolvedValue([{ name: 'orphan', status: 'running', agent: 'claude', ports: [], workspace: '/nope' }] as never)
    const h = buildHandlers(d as never)
    const r = await h['instance:applyCredentials']('orphan')
    expect(r.ok).toBe(false)
    expect(d.adapter.execScript).not.toHaveBeenCalled()
  })
})
