// CPU/memory limit input validation + parsing, shared by the wizard (inline
// errors, advance-gating) and toSpec so both agree on what "valid" means.
// Mirrors sbx v0.35.0: --cpus is a positive integer; -m is a binary-unit size
// (e.g. 1024m, 8g). Empty always means "omit the flag" → sbx applies its default.

const CPUS_RE = /^\d+$/
const MEMORY_RE = /^\d+(\.\d+)?\s*[mMgG]$/

/** Empty (= use sbx default) or a positive integer CPU count. When `maxCpus` is a positive
 *  number, values above it are rejected (host-core bound); a missing/≤0 max applies no bound. */
export function isValidCpus(s: string, maxCpus?: number): boolean {
  const t = s.trim()
  if (t === '') return true
  if (!CPUS_RE.test(t)) return false
  const n = Number(t)
  if (n < 1) return false
  if (typeof maxCpus === 'number' && maxCpus > 0 && n > maxCpus) return false
  return true
}

/** Empty (= use sbx default) or a binary-unit size like `1024m` / `8g`. */
export function isValidMemory(s: string): boolean {
  const t = s.trim()
  if (t === '') return true
  return MEMORY_RE.test(t)
}

/** Validated cpus input → positive integer, or undefined when blank/invalid. */
export function parseCpus(s: string): number | undefined {
  const t = s.trim()
  if (!CPUS_RE.test(t)) return undefined
  const n = Number(t)
  return n >= 1 ? n : undefined
}

/** Validated memory input → normalized (lowercase unit, no spaces), or undefined when blank/invalid. */
export function parseMemory(s: string): string | undefined {
  const t = s.trim()
  if (!MEMORY_RE.test(t)) return undefined
  return t.replace(/\s+/g, '').toLowerCase()
}
