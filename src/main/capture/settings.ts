import { CAPTURE_DEFAULTS, type BurpSettings } from '@shared/capture'

/** The subset of the app store this module needs — keeps it testable without sqlite. */
export interface PrefStore {
  getPref(key: string): string | null
  setPref(key: string, value: string): void
}

const KEY_CA = 'burp.caPath'
const KEY_PROXY = 'burp.proxyPort'
const KEY_UPSTREAM = 'burp.upstreamPort'

export function isValidPort(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535
}

/** Parse a stored port, falling back to `fallback` when absent, unparseable or out of range. */
function readPort(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const n = Number(raw)
  return isValidPort(n) ? n : fallback
}

export function readBurpSettings(store: PrefStore): BurpSettings {
  return {
    caPath: store.getPref(KEY_CA) ?? '',
    proxyPort: readPort(store.getPref(KEY_PROXY), CAPTURE_DEFAULTS.proxyPort),
    upstreamPort: readPort(store.getPref(KEY_UPSTREAM), CAPTURE_DEFAULTS.upstreamPort)
  }
}

/** Persist only the provided keys; returns the merged settings. Throws on an invalid port. */
export function writeBurpSettings(store: PrefStore, patch: Partial<BurpSettings>): BurpSettings {
  if (patch.proxyPort !== undefined) {
    if (!isValidPort(patch.proxyPort)) throw new Error(`Invalid Burp proxy port: ${String(patch.proxyPort)}`)
    store.setPref(KEY_PROXY, String(patch.proxyPort))
  }
  if (patch.upstreamPort !== undefined) {
    if (!isValidPort(patch.upstreamPort)) throw new Error(`Invalid upstream port: ${String(patch.upstreamPort)}`)
    store.setPref(KEY_UPSTREAM, String(patch.upstreamPort))
  }
  if (patch.caPath !== undefined) store.setPref(KEY_CA, patch.caPath.trim())
  return readBurpSettings(store)
}
