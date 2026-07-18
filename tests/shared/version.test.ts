import { describe, it, expect } from 'vitest'
import { APP_NAME, FIXED_AGENT } from '@shared/version'

describe('app constants', () => {
  it('exposes the product name and the fixed MVP agent', () => {
    expect(APP_NAME).toBe('AI Sandbox Manager')
    expect(FIXED_AGENT).toBe('Claude Code')
  })
})
