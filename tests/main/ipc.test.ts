import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))

import { buildHandlers } from '@main/ipc'
import { openStore } from '@main/store/db'
import { AGENT_PROFILES } from '@shared/agents'
import type { SbxAdapter } from '@main/sbx/adapter'
import type { Probes } from '@main/prereq'

const adapter: SbxAdapter = {
  runSbx: async () => ({ stdout: '', stderr: '', code: 0 }),
  listSandboxes: async () => [{ name: 'sbx-a', status: 'running', agent: 'claude', ports: [], workspace: '/w' }],
  createSandbox: async () => {},
  applyPolicy: async () => {},
  publishPorts: async () => {},
  stopSandbox: async () => {},
  removeSandbox: async () => {},
  setSecret: async () => {},
  removeSecret: async () => {},
  listGlobalSecretsRaw: async () => '',
  setCustomSecret: async () => {},
  removeCustomSecret: async () => {},
  setRegistrySecret: async () => {},
  removeRegistrySecret: async () => {},
    listPorts: async () => [], publishPort: async () => {}, unpublishPort: async () => {}, allowNetwork: async () => {}, removeNetwork: async () => {}, policyLog: async () => ({ allowed: 0, blocked: 0, events: [] }),
  checkDockerAuth: async () => 'pass',
  execScript: async () => {},
  execCapture: async () => '',
  listInstanceSecretsRaw: async () => '',
  validateKit: async () => ({ code: 0, out: 'ok', ran: true }),
  listSandboxDir: async () => ({ ok: true, cwd: '', entries: [] }),
  probeSandboxPath: async () => 'missing',
  sandboxTargetsExist: async () => [],
  copyToSandbox: async () => {},
  copyFromSandbox: async () => {},
  listMcpServers: async () => [],
  inspectMcpServer: async () => ({ name: '', transport: 'command', endpoint: '', scopes: [], raw: '' }),
  addMcpServer: async () => {},
  removeMcpServer: async () => {},
  mcpAuthStatus: async () => 'unknown',
  setMcpClientSecret: async () => {},
  removeMcpAuth: async () => {},
  loadMcpServer: async () => {},
  mcpSupported: async () => false
}
const probes: Probes = {
  dockerVersion: async () => 'Docker version 24.0.7', sbxVersion: async () => 'sbx 1.0', sbxAuthed: async () => true,
  freeDiskBytes: async () => 50 * 1024 ** 3, keychainReachable: async () => true
}

describe('buildHandlers', () => {
  it('prereq:check returns a wrapped ok result', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const res = await h['prereq:check']()
    expect(res).toEqual({ ok: true, data: expect.objectContaining({ ok: true }) })
  })

  it('instances:list returns reconciled views', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const res = await h['instances:list']()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data[0].name).toBe('sbx-a')
  })

  it('auth:status returns the parsed Claude auth kind', async () => {
    const authed: SbxAdapter = { ...adapter, listGlobalSecretsRaw: async () => '(global)   service   anthropic   (oauth configured)' }
    const h = buildHandlers({ adapter: authed, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const r = await h['auth:status']()
    expect(r.ok && r.data.anthropic).toBe('oauth')
  })

  it('ssh:detect reports whether SSH_AUTH_SOCK is present', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {}, readLoginEnv: () => ({ SSH_AUTH_SOCK: '/tmp/s.sock' }), platform: 'darwin' })
    const r = await h['ssh:detect']()
    expect(r.ok && r.data.present).toBe(true)
    // The renderer's host-setup guide keys its default OS tab off this.
    expect(r.ok && r.data.platform).toBe('darwin')
  })

  // Regression: SSH_AUTH_SOCK cannot exist on Windows (its agent uses a named pipe), so
  // reading the login env reported "no agent detected" on every Windows host. ssh:detect
  // must not fall back to that check there.
  it('ssh:detect does not report a Windows host as agent-less just because SSH_AUTH_SOCK is unset', async () => {
    // Empty login env + a reachable agent: the old env-only check could only answer false
    // here, so `true` proves the platform is threaded through and the probe is what decides.
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {}, readLoginEnv: () => ({}), platform: 'win32', sshProbe: () => ({ status: 0 }) })
    const r = await h['ssh:detect']()
    expect(r.ok && r.data.platform).toBe('win32')
    expect(r.ok && r.data.present).toBe(true)
  })

  it('env:hasVSCode reports code availability', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const r = await h['env:hasVSCode']()
    expect(r.ok).toBe(true)
    if (r.ok) expect(typeof r.data.present).toBe('boolean')
  })
  it('instance:attach with vscode opener resolves the workspace and opens VS Code', async () => {
    const store = openStore(":memory:")
    store.insertDefinitionSpec({
      definition: { id: 'd', name: 'n', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
      mounts: [{ hostPath: '/ws', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    })
    store.upsertInstanceMeta({ sbxName: 'box', definitionId: 'd', createdByApp: true, createdAt: 't' })
    const openVSCode = vi.fn()
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, openVSCode })
    await h['instance:attach']('box', 'vscode')
    expect(openVSCode).toHaveBeenCalledTimes(1)
    expect(openVSCode.mock.calls[0][1]).toBe('/ws')
  })

  // Regression: "Open Agent in VS Code" silently opened a *terminal* whenever no host
  // workspace dir could be resolved — an instance the app didn't create, or one whose
  // definition was deleted (instance_meta.definition_id is ON DELETE SET NULL). The click
  // must never be answered with a different opener; fail loudly and say why instead.
  it('instance:attach with vscode opener errors instead of silently opening a terminal when the instance has no linked definition', async () => {
    const store = openStore(":memory:")
    store.upsertInstanceMeta({ sbxName: 'orphan', definitionId: null, createdByApp: false, createdAt: 't' })
    const openTerminal = vi.fn()
    const openVSCode = vi.fn()
    const h = buildHandlers({ adapter, store, probes, openTerminal, openVSCode })
    const r = await h['instance:attach']('orphan', 'vscode')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toMatch(/workspace folder|definition/i)
    expect(openTerminal).not.toHaveBeenCalled()
    expect(openVSCode).not.toHaveBeenCalled()
  })
  it('instance:attach with vscode opener errors when the definition has no mount to open', async () => {
    const store = openStore(":memory:")
    store.insertDefinitionSpec({
      definition: { id: 'd2', name: 'n', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
      mounts: [], domains: [], ports: [], hostServices: [], credentials: []
    })
    store.upsertInstanceMeta({ sbxName: 'nomount', definitionId: 'd2', createdByApp: true, createdAt: 't' })
    const openTerminal = vi.fn()
    const h = buildHandlers({ adapter, store, probes, openTerminal, openVSCode: vi.fn() })
    const r = await h['instance:attach']('nomount', 'vscode')
    expect(r.ok).toBe(false)
    expect(openTerminal).not.toHaveBeenCalled()
  })
  it('instance:attach with the terminal opener still opens a terminal', async () => {
    const store = openStore(":memory:")
    store.upsertInstanceMeta({ sbxName: 'orphan', definitionId: null, createdByApp: false, createdAt: 't' })
    const openTerminal = vi.fn()
    const h = buildHandlers({ adapter, store, probes, openTerminal, openVSCode: vi.fn() })
    const r = await h['instance:attach']('orphan', 'terminal')
    expect(r.ok).toBe(true)
    expect(openTerminal).toHaveBeenCalledTimes(1)
  })

  it('instance:commands returns the manual agent + shell commands', async () => {
    const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const r = await h['instance:commands']('box')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.agent).toContain('sbx run --name')
      expect(r.data.agent).toContain('box')
      expect(r.data.agent).toContain('agents')
      expect(r.data.shell).toContain('sbx exec -it')
      expect(r.data.shell).toContain('bash')
    }
  })

  // Regression guard: attaching to a NON-claude definition still produces a valid resume
  // command, using that agent's own (now agent-specific) resumeArgs — opencode's verified
  // value is still `--continue`, distinct from claude's `agents`, codex's `resume --last`,
  // and copilot's `--resume`.
  it('instance:attach resumes a non-claude (opencode) definition correctly', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({
      definition: { id: 'd', name: 'n', description: '', agent: 'opencode', baseImage: 'docker.io/docker/sandbox-templates:opencode', tier: 'locked', createdAt: 't' },
      mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    })
    store.upsertInstanceMeta({ sbxName: 'box', definitionId: 'd', createdByApp: true, createdAt: 't' })
    const openTerminal = vi.fn()
    const h = buildHandlers({ adapter, store, probes, openTerminal })
    await h['instance:attach']('box')
    expect(openTerminal).toHaveBeenCalledWith("sbx run --name 'box' -- --continue")
  })

  // Genuine agent-awareness check: instance:commands must use the LINKED DEFINITION's own
  // agent, not a hardcoded 'claude'. The seed profiles now carry distinct resumeArgs, but
  // this test still temporarily gives opencode an unmistakably distinctive resumeArgs value
  // so a hardcoded 'claude' implementation (which would emit claude's `agents`) is forced to
  // diverge from a correctly agent-aware one. The original value is restored in `finally` so
  // no other test observes the mutation.
  //
  // Uses a hand-built store double (not openStore's real SQLite backing) because db.ts does
  // not yet persist Definition.agent through insertDefinitionSpec/getDefinitionSpec — that
  // round-trip is Task 5's still-RED scope (see tests/main/store/definition-spec.test.ts).
  // Going through the real store here would make this test fail for the wrong reason.
  it('instance:commands uses the linked definition\'s own agent, not always claude', async () => {
    const original = AGENT_PROFILES.opencode.resumeArgs
    AGENT_PROFILES.opencode.resumeArgs = ['--resume-distinctive']
    try {
      const spec = {
        definition: { id: 'd', name: 'n', description: '', agent: 'opencode', baseImage: 'docker.io/docker/sandbox-templates:opencode', tier: 'locked', createdAt: 't' },
        mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
      }
      const store = {
        getDefinitionSpec: vi.fn(() => spec),
        listInstanceMeta: vi.fn(() => [{ sbxName: 'box', definitionId: 'd', createdByApp: true, createdAt: 't' }])
      }
      const h = buildHandlers({ adapter, store, probes, openTerminal: () => {} } as never)
      const r = await h['instance:commands']('box')
      expect(store.getDefinitionSpec).toHaveBeenCalledWith('d')
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data.agent).toContain('--resume-distinctive')
    } finally {
      AGENT_PROFILES.opencode.resumeArgs = original
    }
  })

  it('def:export builds a bundle for selected ids and writes it via saveFile', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Alpha', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    let written = ''
    const saveFile = async (_name: string, contents: string): Promise<string | null> => { written = contents; return '/tmp/out.sbx.json' }
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, saveFile })
    const r = await h['def:export'](['d1'])
    expect(r.ok && r.data.path).toBe('/tmp/out.sbx.json')
    expect(r.ok && r.data.count).toBe(1)
    expect(JSON.parse(written).kind).toBe('sandbox-definitions')
    expect(JSON.parse(written).definitions[0].definition.name).toBe('Alpha')
  })
  it('def:export returns canceled when the save dialog is dismissed', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Alpha', description: '', agent: 'claude', baseImage: 'i', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, saveFile: async () => null })
    const r = await h['def:export'](['d1'])
    expect(r.ok && r.data.canceled).toBe(true)
  })
  it('def:import inserts each definition as a new copy with a fresh id and deduped name', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({ definition: { id: 'existing', name: 'Alpha', description: '', agent: 'claude', baseImage: 'i', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    const bundle = JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now', definitions: [
      { definition: { name: 'Alpha', description: '', baseImage: 'i', tier: 'locked' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }
    ] })
    let n = 0
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, openFile: async () => ({ path: '/tmp/in.sbx.json', contents: bundle }), genId: () => `new-${n++}` })
    const r = await h['def:import']()
    expect(r.ok && r.data.imported).toEqual(['Alpha (imported)'])
    expect(store.listDefinitions().map((d) => d.name).sort()).toEqual(['Alpha', 'Alpha (imported)'])
    expect(store.getDefinitionSpec('new-0')).not.toBeNull()
  })
  it('def:remove deletes the definition and removes its instances', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Alpha', description: '', agent: 'claude', baseImage: 'i', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
    store.upsertInstanceMeta({ sbxName: 'alpha-1', definitionId: 'd1', createdByApp: true, createdAt: 't' })
    store.upsertInstanceMeta({ sbxName: 'alpha-2', definitionId: 'd1', createdByApp: true, createdAt: 't' })
    const removeSandbox = vi.fn(async () => {})
    const h = buildHandlers({ adapter: { ...adapter, removeSandbox }, store, probes, openTerminal: () => {}, cleanupKit: () => {} })
    const r = await h['def:remove']('d1')
    expect(r.ok && r.data.removedInstances).toBe(2)
    expect(removeSandbox).toHaveBeenCalledTimes(2)
    expect(store.getDefinitionSpec('d1')).toBeNull()
    expect(store.listInstanceMeta().filter((m) => m.definitionId === 'd1')).toEqual([])
  })

  // FIX 2 coverage: def:import bypasses the wizard entirely, so the wizard's
  // needsProviderDomainHint never runs for imported bundles. def:import must independently
  // flag a definition that would otherwise generate a kit with zero reachable domains, reusing
  // the SAME shared predicate as the wizard (src/shared/provider-domain.ts) rather than a
  // second copy of the rule.
  it('def:import flags and logs a warning for an imported opencode/locked/no-domains definition', async () => {
    const store = openStore(':memory:')
    const bundle = JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now', definitions: [
      { definition: { name: 'NoDomainBox', description: '', agent: 'opencode', baseImage: 'docker.io/docker/sandbox-templates:opencode', tier: 'locked' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }
    ] })
    const log = { info: vi.fn(), command: () => {}, error: vi.fn() }
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, openFile: async () => ({ path: '/tmp/in.sbx.json', contents: bundle }), log })
    const r = await h['def:import']()
    expect(r.ok && r.data.domainWarnings).toEqual(['NoDomainBox'])
    expect(log.info.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('NoDomainBox') && /no reachable network domains/i.test(c[0]))).toBe(true)
  })
  it('def:import does not flag an imported claude definition', async () => {
    const store = openStore(':memory:')
    const bundle = JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now', definitions: [
      { definition: { name: 'ClaudeBox', description: '', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }
    ] })
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, openFile: async () => ({ path: '/tmp/in.sbx.json', contents: bundle }) })
    const r = await h['def:import']()
    expect(r.ok && r.data.domainWarnings).toBeUndefined()
  })
  it('def:import does not flag an imported opencode definition that already carries domains', async () => {
    const store = openStore(':memory:')
    const bundle = JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now', definitions: [
      { definition: { name: 'HasDomainBox', description: '', agent: 'opencode', baseImage: 'docker.io/docker/sandbox-templates:opencode', tier: 'locked' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: ['api.openai.com'], ports: [], hostServices: [], credentials: [] }
    ] })
    const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, openFile: async () => ({ path: '/tmp/in.sbx.json', contents: bundle }) })
    const r = await h['def:import']()
    expect(r.ok && r.data.domainWarnings).toBeUndefined()
  })

  it('def:import surfaces an error for a malformed file', async () => {
    const h = buildHandlers({ adapter, store: openStore(':memory:'), probes, openTerminal: () => {}, openFile: async () => ({ path: '/tmp/x', contents: 'not json' }) })
    const r = await h['def:import']()
    expect(r.ok).toBe(false)
  })

  it('kit:validate returns invalid for unparseable YAML without shelling out', async () => {
    const h = buildHandlers({ adapter, store: openStore(':memory:'), probes, openTerminal: () => {} } as never)
    const r = await h['kit:validate']('commands: [oops')
    expect(r).toEqual({ ok: true, data: { status: 'invalid', message: expect.stringMatching(/YAML/i) } })
  })

  it('wraps thrown errors as {ok:false}', async () => {
    const boom: SbxAdapter = { ...adapter, listSandboxes: async () => { throw new Error('kaboom') } }
    const h = buildHandlers({ adapter: boom, store: openStore(":memory:"), probes, openTerminal: () => {} })
    const res = await h['instances:list']()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toBe('kaboom')
  })
})
