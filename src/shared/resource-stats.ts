/** Container resource snapshot. Each metric is null when its probe data was missing/unparseable. */
export interface ResourceStats {
  /** CPU used over the sample window, in cores (e.g. 0.7), plus nproc for a "% of N CPUs" view. */
  cpu: { cores: number; ofCpus: number } | null
  /** Memory used and the cgroup limit in bytes (limitBytes null = unlimited). */
  memory: { usedBytes: number; limitBytes: number | null } | null
  /** Container filesystem total and used bytes. */
  disk: { totalBytes: number; usedBytes: number } | null
}

function num(s: string | undefined): number | null {
  if (s === undefined) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function parseCpu(kv: Map<string, string>): ResourceStats['cpu'] {
  const [a, b] = (kv.get('cpu_usec') ?? '').split(/\s+/)
  const s0 = num(a); const s1 = num(b)
  const elapsedNs = num(kv.get('cpu_elapsed_ns'))
  const nproc = num(kv.get('nproc'))
  if (s0 === null || s1 === null || elapsedNs === null || elapsedNs <= 0 || nproc === null || nproc <= 0) return null
  const cores = Math.max(0, ((s1 - s0) / 1e6) / (elapsedNs / 1e9))
  return { cores, ofCpus: nproc }
}

function parseMemory(kv: Map<string, string>): ResourceStats['memory'] {
  const used = num(kv.get('mem_current'))
  if (used === null) return null
  const maxRaw = kv.get('mem_max')
  const limitBytes = maxRaw === undefined || maxRaw === 'max' ? null : num(maxRaw)
  return { usedBytes: used, limitBytes }
}

function parseDisk(kv: Map<string, string>): ResourceStats['disk'] {
  const [t, u] = (kv.get('disk') ?? '').split(/\s+/)
  const total = num(t); const used = num(u)
  if (total === null || used === null) return null
  return { totalBytes: total, usedBytes: used }
}

/**
 * Parse the container resource probe's `key value` stdout into ResourceStats.
 * Expected lines (each optional; a missing one → null for that metric):
 *   cpu_usec <s0> <s1> | cpu_elapsed_ns <ns> | nproc <n> |
 *   mem_current <bytes> | mem_max <bytes|max> | disk <totalBytes> <usedBytes>
 */
export function parseResourceStats(stdout: string): ResourceStats {
  const kv = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sp = trimmed.indexOf(' ')
    if (sp === -1) kv.set(trimmed, '')
    else kv.set(trimmed.slice(0, sp), trimmed.slice(sp + 1).trim())
  }
  return { cpu: parseCpu(kv), memory: parseMemory(kv), disk: parseDisk(kv) }
}
