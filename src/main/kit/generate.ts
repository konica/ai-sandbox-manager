// Pure generator: DefinitionSpec -> mixin kit spec.yaml + the list of host secret
// files the writer must create (0600). Custom credentials become the serviceAuth
// four-block (serviceDomains + serviceAuth + credentials.sources.file + proxyManaged);
// their values arrive host-side via file: sources so they never enter the VM.
import type { DefinitionSpec, CustomCredentialRef } from '@shared/types'
import { serviceById } from '@shared/services'
import { BALANCED_BASELINE } from '../sbx/translate'

export interface GeneratedKit {
  name: string
  specYaml: string
  secretFiles: { relPath: string; envVar: string; credId: string }[]
}

function q(s: string): string {
  return JSON.stringify(s) // YAML-safe double-quoted scalar
}

function customCreds(spec: DefinitionSpec): CustomCredentialRef[] {
  return spec.credentials.filter((c): c is CustomCredentialRef => c.kind === 'custom')
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
  const customs = customCreds(spec)
  const domains = allowedDomains(spec)
  const lines: string[] = ['schemaVersion: "1"', 'kind: mixin', `name: ${name}`, `displayName: ${q(spec.definition.name)}`]

  const net: string[] = []
  if (domains.length) {
    net.push('  allowedDomains:')
    for (const d of domains) net.push(`    - ${q(d)}`)
  }
  if (customs.length) {
    net.push('  serviceDomains:')
    for (const c of customs) for (const d of c.domains) net.push(`    ${d}: ${c.id}`)
    net.push('  serviceAuth:')
    for (const c of customs) {
      net.push(`    ${c.id}:`)
      const h = c.headers[0] ?? { name: 'Authorization', format: 'Bearer %s' }
      net.push(`      headerName: ${q(h.name)}`)
      net.push(`      valueFormat: ${q(h.format)}`)
    }
  }
  if (net.length) {
    lines.push('network:')
    lines.push(...net)
  }

  if (customs.length) {
    lines.push('credentials:', '  sources:')
    for (const c of customs) lines.push(`    ${c.id}:`, '      file:', `        path: ${q('secrets/' + c.id)}`)
    lines.push('environment:', '  proxyManaged:')
    for (const c of customs) lines.push(`    - ${c.envVar}`)
  }

  return {
    name,
    specYaml: lines.join('\n') + '\n',
    secretFiles: customs.map((c) => ({ relPath: 'secrets/' + c.id, envVar: c.envVar, credId: c.id }))
  }
}
