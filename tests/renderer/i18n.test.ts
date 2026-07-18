import { describe, it, expect } from 'vitest'
import { translate } from '../../src/renderer/i18n'

describe('translate', () => {
  it('resolves English by default', () => {
    expect(translate('en', 'nav.definitions')).toBe('Sandbox Definitions')
  })
  it('resolves German', () => {
    expect(translate('de', 'nav.definitions')).toBe('Sandbox-Definitionen')
    expect(translate('de', 'common.next')).toBe('Weiter')
  })
  it('interpolates variables', () => {
    expect(translate('en', 'wizard.stepOf', { n: 2, total: 6 })).toBe('Step 2 of 6')
    expect(translate('de', 'wizard.stepOf', { n: 2, total: 6 })).toBe('Schritt 2 von 6')
    expect(translate('en', 'prereq.disk.fail', { gib: '41.4' })).toBe('41.4 GiB free')
  })
  it('falls back to the key when missing', () => {
    expect(translate('en', 'does.not.exist')).toBe('does.not.exist')
  })
})
