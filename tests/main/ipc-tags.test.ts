import { describe, it, expect } from 'vitest'
import { buildHandlers } from '@main/ipc'
import { openStore, type Store } from '@main/store/db'

function baseDeps(store: Store) {
  return {
    adapter: {
      listSandboxes: async () => [],
      setSecret: async () => {}, setCustomSecret: async () => {}, setRegistrySecret: async () => {},
      checkDockerAuth: async () => 'ok'
    } as never,
    store,
    probes: {} as never,
    openTerminal: () => {},
    materializeKit: () => undefined,
    genHash: () => 'cafebabe'
  }
}

describe('instance:setTags', () => {
  it('normalizes and stores tags for an instance', async () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'proj-a1', definitionId: null, createdByApp: true, createdAt: new Date().toISOString(), credFingerprint: null })
    const h = buildHandlers(baseDeps(store))
    const res = await h['instance:setTags']('proj-a1', [' Prod ', 'prod', 'eu'])
    expect(res.ok).toBe(true)
    expect(store.listInstanceTags().get('proj-a1')).toEqual(['Prod', 'eu'])
  })
})

describe('instance:launch tags', () => {
  it('passes tags through to the launched instance name', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({
      definition: { id: 'd1', name: 'proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: new Date().toISOString() },
      mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    })
    const h = buildHandlers(baseDeps(store))
    const res = await h['instance:launch']('d1', undefined, 'terminal', ['prod'])
    expect(res.ok && res.data.name).toBe('proj-prod-cafebabe')
  })
})

describe('instance:rebuild carries tags', () => {
  it('applies the old instance tags to the newly-launched instance', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({
      definition: { id: 'd1', name: 'proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: new Date().toISOString() },
      mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    })
    let hashCounter = 0
    const deps = {
      adapter: {
        listSandboxes: async () => [],
        removeSandbox: async () => {},
        removeSecret: async () => {},
        removeCustomSecret: async () => {},
        removeRegistrySecret: async () => {},
        setSecret: async () => {}, setCustomSecret: async () => {}, setRegistrySecret: async () => {},
        checkDockerAuth: async () => 'ok'
      } as never,
      store,
      probes: {} as never,
      openTerminal: () => {},
      materializeKit: () => undefined,
      genHash: () => `hash${hashCounter++}`
    }
    const h = buildHandlers(deps)
    const launched = await h['instance:launch']('d1', undefined, 'terminal', ['prod', 'eu'])
    expect(launched.ok).toBe(true)
    const oldName = launched.ok ? launched.data.name : ''
    expect(store.listInstanceTags().get(oldName)).toEqual(['prod', 'eu'])

    const rebuilt = await h['instance:rebuild'](oldName)
    expect(rebuilt.ok).toBe(true)
    const newName = rebuilt.ok ? rebuilt.data.name : ''
    expect(newName).not.toBe(oldName)
    expect(store.listInstanceTags().get(newName)).toEqual(['prod', 'eu'])
  })
})
