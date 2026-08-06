import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '@main/store/db'

let store: Store
beforeEach(() => { store = openStore(':memory:') })

function seedInstance(name: string): void {
  store.upsertInstanceMeta({ sbxName: name, definitionId: null, createdByApp: true, createdAt: new Date().toISOString(), credFingerprint: null })
}

describe('instance tags', () => {
  it('returns an empty map when nothing is tagged', () => {
    expect(store.listInstanceTags().size).toBe(0)
  })
  it('stores and reads back tags for an instance in order', () => {
    seedInstance('proj-a1')
    store.setInstanceTags('proj-a1', ['prod', 'eu'])
    expect(store.listInstanceTags().get('proj-a1')).toEqual(['prod', 'eu'])
  })
  it('replaces the full tag set on a second write', () => {
    seedInstance('proj-a1')
    store.setInstanceTags('proj-a1', ['prod', 'eu'])
    store.setInstanceTags('proj-a1', ['staging'])
    expect(store.listInstanceTags().get('proj-a1')).toEqual(['staging'])
  })
  it('drops tags when the instance meta is deleted', () => {
    seedInstance('proj-a1')
    store.setInstanceTags('proj-a1', ['prod'])
    store.deleteInstanceMeta('proj-a1')
    expect(store.listInstanceTags().has('proj-a1')).toBe(false)
  })
  it('isolates tags across instances: deleting one leaves the other untouched', () => {
    seedInstance('proj-a1')
    seedInstance('proj-b1')
    store.setInstanceTags('proj-a1', ['prod', 'eu'])
    store.setInstanceTags('proj-b1', ['staging'])
    store.deleteInstanceMeta('proj-a1')
    expect(store.listInstanceTags().has('proj-a1')).toBe(false)
    expect(store.listInstanceTags().get('proj-b1')).toEqual(['staging'])
  })
})
