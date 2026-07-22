import { describe, it, expect } from 'vitest'
import { PROXY_TYPES, proxyTone, proxyLabelKey, proxyMeaningKey } from '../../src/shared/proxy-types'

describe('proxy-types', () => {
  it('maps known types to tones', () => {
    expect(proxyTone('forward')).toBe('ok')
    expect(proxyTone('forward-bypass')).toBe('warn')
    expect(proxyTone('transparent')).toBe('warn')
    expect(proxyTone('network')).toBe('neutral')
    expect(proxyTone('browser-open')).toBe('info')
  })
  it('defaults unknown/empty types to neutral', () => {
    expect(proxyTone('whatever')).toBe('neutral')
    expect(proxyTone('')).toBe('neutral')
  })
  it('lists the five canonical types in order for the legend', () => {
    expect(PROXY_TYPES).toEqual(['forward', 'forward-bypass', 'transparent', 'network', 'browser-open'])
  })
  it('maps known types to i18n key slugs; unknown/empty → null', () => {
    expect(proxyLabelKey('forward')).toBe('detail.proxyForwardLabel')
    expect(proxyLabelKey('forward-bypass')).toBe('detail.proxyForwardBypassLabel')
    expect(proxyMeaningKey('browser-open')).toBe('detail.proxyBrowserOpenMeaning')
    expect(proxyLabelKey('nope')).toBeNull()
    expect(proxyMeaningKey('')).toBeNull()
  })
})
