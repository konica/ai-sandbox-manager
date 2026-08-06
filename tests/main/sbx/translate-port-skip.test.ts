import { describe, it, expect } from 'vitest'
import { portsForLaunch, launchCommand } from '../../../src/main/sbx/translate'
import type { DefinitionSpec, PortIntent } from '@shared/types'

const ports: PortIntent[] = [
  { hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: '' }, // fixed
  { hostPort: null, containerPort: 9229, protocol: 'tcp', label: '' }  // ephemeral
]

describe('portsForLaunch', () => {
  it('keeps every port on a first launch', () => {
    expect(portsForLaunch(ports, false)).toEqual(ports)
  })
  it('keeps only ephemeral ports on a subsequent launch', () => {
    expect(portsForLaunch(ports, true)).toEqual([ports[1]])
  })
})

function spec(): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: '' },
    mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
    domains: [], ports, hostServices: [], credentials: []
  }
}

describe('launchCommand ports override', () => {
  it('publishes only the ports it is given', () => {
    const cmd = launchCommand(spec(), 'proj-a1', undefined, undefined, portsForLaunch(ports, true))
    expect(cmd).toContain('--publish 9229/tcp')
    expect(cmd).not.toContain('8080:3000')
  })
})
