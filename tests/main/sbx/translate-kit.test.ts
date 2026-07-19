import { describe, it, expect } from 'vitest'
import { launchCommand } from '../../../src/main/sbx/translate'
import type { DefinitionSpec } from '../../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'proj', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
}

describe('launchCommand with a kit', () => {
  it('appends --kit to create and omits the standalone policy step', () => {
    const cmd = launchCommand(spec, 'proj', undefined, '/base/kits/ai-sandbox-d1')
    expect(cmd).toContain('--kit /base/kits/ai-sandbox-d1')
    expect(cmd).not.toContain('policy allow network')
    expect(cmd).toContain('sbx run --name proj')
  })
  it('without a kit keeps the existing behaviour', () => {
    const cmd = launchCommand(spec, 'proj')
    expect(cmd).not.toContain('--kit')
  })
})
