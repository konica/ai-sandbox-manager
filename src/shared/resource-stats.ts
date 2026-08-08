/** Container resource snapshot. Each metric is null when its probe data was missing/unparseable. */
export interface ResourceStats {
  /**
   * CPU used over the sample window, in cores (e.g. 0.7). `ofCpus` is nproc (CPUs the container
   * can see); `limitCores` is the cfs quota in cores when one is set (null = no quota → the
   * effective ceiling is `ofCpus`, which is what we display as the denominator).
   */
  cpu: { cores: number; ofCpus: number; limitCores: number | null } | null
  /**
   * Memory used and the cgroup limit in bytes (`limitBytes` null = no cgroup limit). `machineBytes`
   * is total machine/VM memory (MemTotal), used as the denominator when there is no cgroup limit —
   * matching how `sbx` reports "used / total".
   */
  memory: { usedBytes: number; limitBytes: number | null; machineBytes: number | null } | null
  /** Container filesystem total and used bytes. */
  disk: { totalBytes: number; usedBytes: number } | null
}

function num(s: string | undefined): number | null {
  if (s === undefined || s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** cfs quota in cores from `cpu_max <quota> <period>`; null when unset/"max" or unparseable. */
function parseCpuLimit(kv: Map<string, string>): number | null {
  const [q, p] = (kv.get('cpu_max') ?? '').split(/\s+/)
  if (q === undefined || q === 'max') return null
  const quota = num(q); const period = num(p)
  if (quota === null || quota <= 0 || period === null || period <= 0) return null
  return quota / period
}

function parseCpu(kv: Map<string, string>): ResourceStats['cpu'] {
  const [a, b] = (kv.get('cpu_usec') ?? '').split(/\s+/)
  const s0 = num(a); const s1 = num(b)
  const elapsedNs = num(kv.get('cpu_elapsed_ns'))
  const nproc = num(kv.get('nproc'))
  if (s0 === null || s1 === null || elapsedNs === null || elapsedNs <= 0 || nproc === null || nproc <= 0) return null
  const cores = Math.max(0, ((s1 - s0) / 1e6) / (elapsedNs / 1e9))
  return { cores, ofCpus: nproc, limitCores: parseCpuLimit(kv) }
}

function parseMemory(kv: Map<string, string>): ResourceStats['memory'] {
  const current = num(kv.get('mem_current'))
  if (current === null) return null
  const inactive = num(kv.get('mem_inactive'))
  const used = inactive !== null ? Math.max(0, current - inactive) : current
  const maxRaw = kv.get('mem_max')
  const limitBytes = maxRaw === undefined || maxRaw === 'max' ? null : num(maxRaw)
  const machine = num(kv.get('mem_total'))
  const machineBytes = machine !== null && machine > 0 ? machine : null
  return { usedBytes: used, limitBytes, machineBytes }
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
 *   cpu_usec <s0> <s1> | cpu_elapsed_ns <ns> | nproc <n> | cpu_max <quota|max> <period> |
 *   mem_current <bytes> | mem_max <bytes|max> | mem_inactive <bytes> | mem_total <bytes> |
 *   disk <totalBytes> <usedBytes>
 * mem_inactive (reclaimable page cache) is subtracted from mem_current for usedBytes when present,
 * matching `docker stats`' memory accounting.
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
