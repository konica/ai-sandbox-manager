import type { PrereqCheck, PrereqResult } from '@shared/types'

export interface Probes {
  hasDocker(): Promise<boolean>
  sbxVersion(): Promise<string | null>
  sbxAuthed(): Promise<boolean>
  freeDiskBytes(): Promise<number>
  keychainReachable(): Promise<boolean>
}

const GiB = 1024 ** 3

export async function checkPrereqs(probes: Probes, minDiskBytes: number = 2 * GiB): Promise<PrereqResult> {
  const docker = await probes.hasDocker()
  const version = await probes.sbxVersion()
  const authed = version ? await probes.sbxAuthed() : false
  const disk = await probes.freeDiskBytes()
  const keychain = await probes.keychainReachable()

  const checks: PrereqCheck[] = [
    { id: 'docker', label: 'Docker', ok: docker, detail: docker ? 'Docker is available' : 'Docker not found', remediation: docker ? undefined : 'Install Docker Desktop and ensure it is running.' },
    { id: 'sbx', label: 'Docker Sandboxes (sbx)', ok: version !== null, detail: version ?? 'sbx not found on PATH', remediation: version ? undefined : 'Install the Docker Sandboxes CLI (`sbx`).' },
    { id: 'auth', label: 'sbx authentication', ok: authed, detail: authed ? 'Authenticated' : 'Not logged in', remediation: authed ? undefined : 'Run `sbx login` in your terminal, then re-check.' },
    { id: 'disk', label: 'Disk space', ok: disk >= minDiskBytes, detail: `${(disk / GiB).toFixed(1)} GiB free`, remediation: disk >= minDiskBytes ? undefined : 'Free up disk space; sandboxes need room for images.' },
    { id: 'keychain', label: 'OS keychain', ok: keychain, detail: keychain ? 'Reachable' : 'Not reachable — encrypted fallback will be used', remediation: undefined }
  ]

  const ok = checks.filter((c) => c.id === 'docker' || c.id === 'sbx' || c.id === 'auth').every((c) => c.ok)
  return { ok, checks }
}
