import { describe, it, expect } from 'vitest'
import { portIntentToPublishSpec } from '../../../src/main/sbx/translate'

describe('portIntentToPublishSpec', () => {
  it('explicit host port with protocol', () => {
    expect(portIntentToPublishSpec({ hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: '' })).toBe('8080:3000/tcp')
  })
  it('ephemeral host port omits the host part', () => {
    expect(portIntentToPublishSpec({ hostPort: null, containerPort: 9229, protocol: 'tcp6', label: '' })).toBe('9229/tcp6')
  })
})
