import { describe, it, expect } from 'vitest'
import type { PortIntent, HostServiceIntent, DefinitionSpec } from '../../src/shared/types'

describe('port types', () => {
  it('accepts an ephemeral tcp port (null host port)', () => {
    const p: PortIntent = { hostPort: null, containerPort: 3000, protocol: 'tcp', label: '' }
    expect(p.hostPort).toBeNull()
  })
  it('accepts an explicit tcp6 port', () => {
    const p: PortIntent = { hostPort: 8080, containerPort: 3000, protocol: 'tcp6', label: 'web' }
    expect(p.protocol).toBe('tcp6')
  })
  it('accepts a host-service intent and spec.hostServices', () => {
    const hs: HostServiceIntent = { hostPort: 11434, label: 'Ollama' }
    const spec = { hostServices: [hs] } as Pick<DefinitionSpec, 'hostServices'>
    expect(spec.hostServices[0].hostPort).toBe(11434)
  })
})
