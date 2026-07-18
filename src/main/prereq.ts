import type { PrereqCheck, PrereqResult } from '@shared/types'

export interface Probes {
  dockerVersion(): Promise<string | null>
  sbxVersion(): Promise<string | null>
  sbxAuthed(): Promise<boolean>
  freeDiskBytes(): Promise<number>
  keychainReachable(): Promise<boolean>
}

const GiB = 1024 ** 3

export async function checkPrereqs(probes: Probes, minDiskBytes: number = 2 * GiB): Promise<PrereqResult> {
  const docker = await probes.dockerVersion()
  const version = await probes.sbxVersion()
  const authed = version ? await probes.sbxAuthed() : false
  const disk = await probes.freeDiskBytes()
  const keychain = await probes.keychainReachable()

  const checks: PrereqCheck[] = [
    { id: 'docker', ok: docker !== null, value: docker ?? undefined },
    { id: 'sbx', ok: version !== null, value: version ?? undefined },
    { id: 'auth', ok: authed },
    { id: 'disk', ok: disk >= minDiskBytes, freeGiB: (disk / GiB).toFixed(1) },
    { id: 'keychain', ok: keychain }
  ]

  const ok = checks.filter((c) => c.id === 'docker' || c.id === 'sbx' || c.id === 'auth').every((c) => c.ok)
  return { ok, checks }
}
