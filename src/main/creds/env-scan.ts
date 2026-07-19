import { KNOWN_SERVICES } from '@shared/services'

export interface EnvHit {
  serviceId: string
  label: string
  envVar: string
  masked: string
}

export function maskValue(v: string): string {
  return v.length <= 6 ? '…' : v.slice(0, 6) + '…'
}

export function scanEnv(env: Record<string, string | undefined>): EnvHit[] {
  const hits: EnvHit[] = []
  for (const svc of KNOWN_SERVICES) {
    const envVar = svc.envVars.find((v) => (env[v] ?? '').trim().length > 0)
    if (envVar) hits.push({ serviceId: svc.id, label: svc.label, envVar, masked: maskValue(env[envVar]!.trim()) })
  }
  return hits
}
