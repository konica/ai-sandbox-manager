import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildHandlers } from '@main/ipc'
import { SbxError } from '@shared/errors'
import type { DefinitionSpec, InstanceMeta } from '@shared/types'

const SPEC: DefinitionSpec = {
  definition: { id: 'd1', name: 'xray', description: '', agent: 'claude', baseImage: 'img', tier: 'open', createdAt: 't' },
  mounts: [{ hostPath: '/w/xray', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: []
}

let base: string
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'sbxmgr-rebuild-')) })
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

/**
 * Records the order of the calls that matter to this ticket, so we can assert that capture
 * happens BEFORE the sandbox is destroyed rather than merely that both happened.
 */
function harness(over: { copyFails?: boolean; hasSessions?: boolean } = {}) {
  const calls: string[] = []
  // An in-memory Store double rather than the real sqlite one: this ticket is about call
  // ordering in the rebuild handler, and the DB is an unrelated collaborator here.
  let meta: InstanceMeta[] = [{ sbxName: 'xray-old', definitionId: 'd1', createdByApp: true, createdAt: 't' }]
  const store = {
    getDefinitionSpec: (id: string) => (id === 'd1' ? SPEC : null),
    getDefinition: (id: string) => (id === 'd1' ? SPEC.definition : null),
    listDefinitions: () => [SPEC.definition],
    listInstanceMeta: () => meta,
    upsertInstanceMeta: (m: InstanceMeta) => { meta = [...meta.filter((x) => x.sbxName !== m.sbxName), m] },
    deleteInstanceMeta: (n: string) => { meta = meta.filter((x) => x.sbxName !== n) },
    listInstanceTags: () => new Map<string, string[]>(),
    setInstanceTags: () => {},
    deleteInstanceTags: () => {}
  }

  const hasSessions = over.hasSessions ?? true
  const adapter = {
    listSandboxes: async () => [{ name: 'xray-old', status: 'running' as const, agent: 'claude', ports: [], workspace: '/w/xray' }],
    probeSandboxPath: async (_n: string, p: string) => (hasSessions && p.endsWith('/projects') ? 'dir' as const : 'missing' as const),
    copyFromSandbox: async (_n: string, src: string, dest: string) => {
      calls.push('copyFromSandbox')
      if (over.copyFails) throw new SbxError('generic', 'simulated copy failure')
      const leaf = src.split('/').pop() as string
      mkdirSync(join(dest, leaf, '-w-xray'), { recursive: true })
      writeFileSync(join(dest, leaf, '-w-xray', 'a1b2.jsonl'), '{}\n')
    },
    removeSandbox: async () => { calls.push('removeSandbox') },
    removeSecret: async () => {}, removeCustomSecret: async () => {}, removeRegistrySecret: async () => {},
    setSecret: async () => {}, setCustomSecret: async () => {}, setRegistrySecret: async () => {},
    checkDockerAuth: async () => 'pass' as const,
    listMcpServers: async () => []
  }

  let launched = ''
  const handlers = buildHandlers({
    adapter: adapter as never,
    store,
    probes: {} as never,
    openTerminal: (cmd: string) => { calls.push('openTerminal'); launched = cmd },
    genHash: () => 'newhash',
    sessionArchiveBaseDir: base
  } as never)

  return { handlers, calls, store, launchedCommand: () => launched }
}

describe('instance:rebuild session preservation', () => {
  it('captures the sessions before destroying the sandbox', async () => {
    // Ordering IS the safety property: cleanupInstance removes the sandbox irreversibly,
    // so a capture that ran afterwards would have nothing left to capture.
    const h = harness()

    await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(h.calls.indexOf('copyFromSandbox')).toBeGreaterThan(-1)
    expect(h.calls.indexOf('copyFromSandbox')).toBeLessThan(h.calls.indexOf('removeSandbox'))
  })

  it('restores the archive into the new sandbox at launch', async () => {
    const h = harness()

    await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(h.launchedCommand()).toContain('sbx cp')
    expect(h.launchedCommand()).toContain(':/home/agent/.claude/')
  })

  it('aborts without destroying the sandbox when the capture fails', async () => {
    // The whole point: if the conversations could not be copied out, they exist nowhere
    // else — removing the sandbox anyway would destroy the thing we set out to protect.
    const h = harness({ copyFails: true })

    const res = await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(res.ok).toBe(false)
    expect(h.calls).not.toContain('removeSandbox')
    expect(h.calls).not.toContain('openTerminal')
  })

  it('rebuilds as before when the instance has no sessions yet', async () => {
    const h = harness({ hasSessions: false })

    const res = await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(res.ok).toBe(true)
    expect(h.calls).toContain('removeSandbox')
    expect(h.launchedCommand()).not.toContain('sbx cp')
  })
})
