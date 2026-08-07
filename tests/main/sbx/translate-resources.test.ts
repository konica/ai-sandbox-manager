import { describe, it, expect } from 'vitest'
import { specToCreateArgs } from '../../../src/main/sbx/translate'
import type { DefinitionSpec } from '@shared/types'

function spec(over: Partial<DefinitionSpec['definition']> = {}): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: '', ...over },
    mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
    domains: [], ports: [], hostServices: [], credentials: []
  }
}

describe('specToCreateArgs resource limits', () => {
  it('omits both flags when cpus/memory are unset', () => {
    const args = specToCreateArgs(spec())
    expect(args).not.toContain('--cpus')
    expect(args).not.toContain('-m')
  })

  it('appends --cpus when a positive integer is set', () => {
    const args = specToCreateArgs(spec({ cpus: 4 }))
    expect(args.join(' ')).toContain('--cpus 4')
  })

  it('appends -m when memory is set', () => {
    const args = specToCreateArgs(spec({ memory: '8g' }))
    expect(args.join(' ')).toContain('-m 8g')
  })

  it('omits --cpus when cpus is 0', () => {
    const args = specToCreateArgs(spec({ cpus: 0 }))
    expect(args).not.toContain('--cpus')
  })

  it('appends both when both set', () => {
    const args = specToCreateArgs(spec({ cpus: 2, memory: '1024m' }))
    const s = args.join(' ')
    expect(s).toContain('--cpus 2')
    expect(s).toContain('-m 1024m')
  })
})
