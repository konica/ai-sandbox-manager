import { describe, it, expect } from 'vitest'
import { hasSiblingInstances } from '../../src/renderer/App'
import type { InstanceView } from '../../src/shared/types'

const inst = (name: string, definitionId: string | null): InstanceView =>
  ({ name, status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId, definitionName: 'P', tier: 'locked' })

describe('hasSiblingInstances', () => {
  it('true when another instance shares the definition', () => {
    const list = [inst('a-1', 'd1'), inst('a-2', 'd1'), inst('b-1', 'd2')]
    expect(hasSiblingInstances(list, 'a-1')).toBe(true)
  })
  it('false when it is the only instance of its definition', () => {
    const list = [inst('a-1', 'd1'), inst('b-1', 'd2')]
    expect(hasSiblingInstances(list, 'a-1')).toBe(false)
  })
  it('false for an unlinked instance (no definition)', () => {
    const list = [inst('a-1', null), inst('a-2', null)]
    expect(hasSiblingInstances(list, 'a-1')).toBe(false)
  })
})
