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
function harness(over: {
  copyFails?: boolean
  hasSessions?: boolean
  /** Where the OLD sandbox is really mounted, as `sbx ls` reports it. */
  liveWorkspace?: string
  /** The definition's mounts as they stand now (may differ from the live sandbox). */
  mounts?: DefinitionSpec['mounts']
} = {}) {
  const calls: string[] = []
  const logs: string[] = []
  const SPEC_NOW: DefinitionSpec = over.mounts ? { ...SPEC, mounts: over.mounts } : SPEC
  // An in-memory Store double rather than the real sqlite one: this ticket is about call
  // ordering in the rebuild handler, and the DB is an unrelated collaborator here.
  let meta: InstanceMeta[] = [{ sbxName: 'xray-old', definitionId: 'd1', createdByApp: true, createdAt: 't' }]
  const store = {
    getDefinitionSpec: (id: string) => (id === 'd1' ? SPEC_NOW : null),
    getDefinition: (id: string) => (id === 'd1' ? SPEC_NOW.definition : null),
    listDefinitions: () => [SPEC_NOW.definition],
    listInstanceMeta: () => meta,
    upsertInstanceMeta: (m: InstanceMeta) => { meta = [...meta.filter((x) => x.sbxName !== m.sbxName), m] },
    deleteInstanceMeta: (n: string) => { meta = meta.filter((x) => x.sbxName !== n) },
    listInstanceTags: () => new Map<string, string[]>(),
    setInstanceTags: () => {},
    deleteInstanceTags: () => {}
  }

  const hasSessions = over.hasSessions ?? true
  const adapter = {
    listSandboxes: async () => [{ name: 'xray-old', status: 'running' as const, agent: 'claude', ports: [], workspace: over.liveWorkspace ?? '/w/xray' }],
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
    sessionArchiveBaseDir: base,
    log: { info: (m: string) => logs.push(m), error: (m: string) => logs.push(m), command: () => {} }
  } as never)

  return { handlers, calls, store, logs, launchedCommand: () => launched }
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

/**
 * "Preserve Claude sessions" unchecked means *do not restore* — it does not mean *discard*.
 * Capture still runs, so an accidental uncheck cannot destroy history irrecoverably: the
 * archive is still listed under Session backups and can be exported. But it must not BLOCK a
 * rebuild the user explicitly asked to be clean, so the abort applies only when the restore
 * was actually requested.
 */
describe('instance:rebuild preserveSessions = false', () => {
  it('emits no restore steps', async () => {
    const h = harness()

    await h.handlers['instance:rebuild']('xray-old', 'terminal', false)

    expect(h.launchedCommand()).not.toContain('sbx cp')
  })

  it('still captures the archive', async () => {
    // Not restoring is not the same as not backing up.
    const h = harness()

    await h.handlers['instance:rebuild']('xray-old', 'terminal', false)

    expect(h.calls).toContain('copyFromSandbox')
  })

  it('proceeds despite a capture failure instead of aborting', async () => {
    // Nothing is being restored, so a failed backup must not block the rebuild.
    const h = harness({ copyFails: true })

    const res = await h.handlers['instance:rebuild']('xray-old', 'terminal', false)

    expect(res.ok).toBe(true)
    expect(h.calls).toContain('removeSandbox')
    expect(h.calls).toContain('openTerminal')
  })

  it('defaults to preserving when the flag is omitted', async () => {
    // Back-compat: every existing caller omits it and must keep today's behaviour.
    const h = harness()

    await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(h.launchedCommand()).toContain('sbx cp')
  })

  it('still aborts on a capture failure when preserving IS requested', async () => {
    const h = harness({ copyFails: true })

    const res = await h.handlers['instance:rebuild']('xray-old', 'terminal', true)

    expect(res.ok).toBe(false)
    expect(h.calls).not.toContain('removeSandbox')
  })
})

/**
 * Claude names its project directory after the workspace path, so sessions restored under a
 * DIFFERENT primary folder are present on disk but invisible to the agent. That silent
 * outcome is the worst shape of failure — it reads as "the feature is broken" — so the
 * rebuild says so out loud instead.
 */
describe('instance:rebuild changed primary folder', () => {
  const warned = (logs: string[]) => logs.filter((l) => /folder|workspace path/i.test(l) && /session/i.test(l))

  it('warns when the primary folder changed, naming both paths', async () => {
    const h = harness({ liveWorkspace: '/w/xray', mounts: [{ hostPath: '/w/xray-renamed', mode: 'direct', isPrimary: true }] })

    await h.handlers['instance:rebuild']('xray-old', 'terminal')

    const [msg] = warned(h.logs)
    expect(msg).toBeDefined()
    expect(msg).toContain('/w/xray')
    expect(msg).toContain('/w/xray-renamed')
  })

  it('stays silent when the primary folder is unchanged', async () => {
    const h = harness({ liveWorkspace: '/w/xray' })

    await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(warned(h.logs)).toEqual([])
  })

  it('does not warn over a cosmetic path difference', async () => {
    // Same normalisation reconciler.ts uses: slash direction, trailing slash, case.
    const h = harness({ liveWorkspace: 'C:\\W\\Xray', mounts: [{ hostPath: 'c:/w/xray/', mode: 'direct', isPrimary: true }] })

    await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(warned(h.logs)).toEqual([])
  })

  it('does not warn when only a NON-primary folder was added', async () => {
    // Adding an extra folder is the common mount-drift case and does not move the project
    // directory — only the primary path governs its name.
    const h = harness({
      liveWorkspace: '/w/xray',
      mounts: [
        { hostPath: '/w/xray', mode: 'direct', isPrimary: true },
        { hostPath: '/w/extra', mode: 'direct', isPrimary: false }
      ]
    })

    await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(warned(h.logs)).toEqual([])
  })

  it('warns without failing the rebuild', async () => {
    // Advisory only — it must never block the rebuild it is describing.
    const h = harness({ liveWorkspace: '/w/xray', mounts: [{ hostPath: '/w/moved', mode: 'direct', isPrimary: true }] })

    const res = await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(res.ok).toBe(true)
    expect(h.calls).toContain('removeSandbox')
    expect(h.calls).toContain('openTerminal')
  })

  it('stays silent when there were no sessions to restore', async () => {
    // Nothing was carried over, so there is nothing for the changed path to hide.
    const h = harness({ hasSessions: false, liveWorkspace: '/w/xray', mounts: [{ hostPath: '/w/moved', mode: 'direct', isPrimary: true }] })

    await h.handlers['instance:rebuild']('xray-old', 'terminal')

    expect(warned(h.logs)).toEqual([])
  })
})
