import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '@main/store/db'
import type { DefinitionSpec } from '@shared/types'

let store: Store
beforeEach(() => { store = openStore(':memory:') })

const base = (copyFiles: { hostPath: string; sandboxPath: string }[]): DefinitionSpec => ({
  definition: { id: 'd1', name: 'proj', description: '', baseImage: 'img', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: [], copyFiles
})

describe('copy_file child table', () => {
  it('round-trips copyFiles', () => {
    store.insertDefinitionSpec(base([{ hostPath: '/Users/me/.claude/statusline.sh', sandboxPath: '~/.claude/statusline.sh' }]))
    expect(store.getDefinitionSpec('d1')?.copyFiles).toEqual([
      { hostPath: '/Users/me/.claude/statusline.sh', sandboxPath: '~/.claude/statusline.sh' }
    ])
  })
  it('defaults to [] when none are set', () => {
    store.insertDefinitionSpec(base([]))
    expect(store.getDefinitionSpec('d1')?.copyFiles).toEqual([])
  })
  it('update replaces the copyFiles set', () => {
    store.insertDefinitionSpec(base([{ hostPath: '/a', sandboxPath: '~/a' }]))
    store.updateDefinitionSpec(base([{ hostPath: '/b', sandboxPath: '~/b' }]))
    expect(store.getDefinitionSpec('d1')?.copyFiles).toEqual([{ hostPath: '/b', sandboxPath: '~/b' }])
  })
})
