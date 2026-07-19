// Pure generator: DefinitionSpec -> a network-allowlist mixin kit spec.yaml.
//
// The Phase 0 spike proved that mixin-kit `serviceAuth` header injection does NOT
// fire for custom domains (the proxy tunnels them `forward-bypass`). So the kit's
// only job is reachability — `network.allowedDomains` — covering the tier baseline,
// user domains, built-in-service domains, and custom-credential hosts. Credential
// INJECTION happens at launch via `sbx secret set` / `sbx secret set-custom`
// (see Task 11), not through the kit. No secret ever enters the kit.
import type { DefinitionSpec } from '@shared/types'
import { serviceById } from '@shared/services'
import { BALANCED_BASELINE } from '../sbx/translate'

export interface GeneratedKit {
  name: string
  specYaml: string
  secretFiles: { relPath: string; envVar: string; credId: string }[] // always [] now; kept for writeKit compat
}

function q(s: string): string {
  return JSON.stringify(s) // YAML-safe double-quoted scalar
}

function serviceDomains(serviceId: string): string[] {
  const s = serviceById(serviceId)
  return s ? s.domains : []
}

function allowedDomains(spec: DefinitionSpec): string[] {
  const svc = spec.credentials.flatMap((c) => (c.kind === 'service' ? serviceDomains(c.serviceId) : c.domains))
  const tierBase = spec.definition.tier === 'balanced' ? BALANCED_BASELINE : []
  const open = spec.definition.tier === 'open'
  const all = open ? ['**'] : [...tierBase, ...spec.domains, ...svc]
  return [...new Set(all.filter((d) => d.trim().length > 0))]
}

export function buildKitSpec(spec: DefinitionSpec): GeneratedKit {
  const name = 'ai-sandbox-' + spec.definition.id.slice(0, 8)
  const domains = allowedDomains(spec)
  const lines: string[] = ['schemaVersion: "1"', 'kind: mixin', `name: ${name}`, `displayName: ${q(spec.definition.name)}`]

  if (domains.length) {
    lines.push('network:', '  allowedDomains:')
    for (const d of domains) lines.push(`    - ${q(d)}`)
  }

  return { name, specYaml: lines.join('\n') + '\n', secretFiles: [] }
}
