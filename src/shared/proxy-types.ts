// Single source of truth for proxy-type presentation on the Monitoring tab.
// The `proxy_type` values come from `sbx policy log` (see the Docker monitoring docs).
// This module owns only the tone mapping and the canonical ordered list; friendly
// labels and meanings live in i18n (keyed by the slugs below) so both languages stay in sync.

export type ProxyTone = 'ok' | 'warn' | 'neutral' | 'info'

/** Canonical ordered list of known proxy types — used to render the legend. */
export const PROXY_TYPES: readonly string[] = ['forward', 'forward-bypass', 'transparent', 'network', 'browser-open']

const TONES: Record<string, ProxyTone> = {
  forward: 'ok',
  'forward-bypass': 'warn',
  transparent: 'warn',
  network: 'neutral',
  'browser-open': 'info'
}

/** Semantic tone for a proxy type; unknown/empty → 'neutral'. */
export function proxyTone(type: string): ProxyTone {
  return TONES[type] ?? 'neutral'
}

// Raw proxy_type → i18n key slug (PascalCase).
const SLUGS: Record<string, string> = {
  forward: 'Forward',
  'forward-bypass': 'ForwardBypass',
  transparent: 'Transparent',
  network: 'Network',
  'browser-open': 'BrowserOpen'
}

/** i18n key for a proxy type's friendly label, or null for unknown/empty. */
export function proxyLabelKey(type: string): string | null {
  const s = SLUGS[type]
  return s ? `detail.proxy${s}Label` : null
}

/** i18n key for a proxy type's plain-language meaning, or null for unknown/empty. */
export function proxyMeaningKey(type: string): string | null {
  const s = SLUGS[type]
  return s ? `detail.proxy${s}Meaning` : null
}
