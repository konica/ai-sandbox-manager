import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'

describe('capture lifecycle wiring', () => {
  it('feeds running instance names to the capture session on each list', async () => {
    const onRunningInstances = vi.fn()
    const adapter = {
      listSandboxes: vi.fn(async () => [
        { name: 'a', status: 'running', agent: 'claude', workspace: '', createdAt: '' },
        { name: 'b', status: 'stopped', agent: 'claude', workspace: '', createdAt: '' }
      ])
    }
    // `instances:list` runs the real reconciler, so the store fake must satisfy it. Copy the
    // fake from tests/main/reconciler.test.ts rather than inventing a thinner one here —
    // reconcile() calls more store methods than are obvious, and a missing one fails with a
    // confusing TypeError instead of a useful assertion.
    const store = {
      listInstanceMeta: () => [], listInstanceTags: () => new Map<string, string[]>(),
      deleteInstanceMeta: vi.fn(), deleteInstanceTags: vi.fn(), listDefinitions: () => [],
      getDefinition: () => null, upsertInstanceMeta: vi.fn(), setInstanceTags: vi.fn(),
      updateInstanceFingerprint: vi.fn(), getDefinitionSpec: () => null
    }
    const h = buildHandlers({
      adapter, store, probes: {}, openTerminal: vi.fn(),
      capture: { status: vi.fn(), enable: vi.fn(), disable: vi.fn(), onRunningInstances }
    } as never)

    await h['instances:list']()
    expect(onRunningInstances).toHaveBeenCalledWith(['a'])
  })
})
