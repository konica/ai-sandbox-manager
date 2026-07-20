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

// The app always launches the `claude` agent, so every sandbox must reach Anthropic
// for inference AND the OAuth /login token exchange — independent of credentials.
export const CLAUDE_AGENT_DOMAINS = [
  'api.anthropic.com', 'console.anthropic.com', 'claude.ai',
  'platform.claude.com', 'claude.com', 'downloads.claude.ai', 'mcp-proxy.anthropic.com'
]

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
  // service → its domains; custom → its target hosts; registry → the registry host, but only
  // when the credential is injected into the sandbox (global/sandbox scope) so the agent can
  // pull/push. Host-only registry creds pull on the host, so they need no in-VM reachability.
  const svc = spec.credentials.flatMap((c) => {
    if (c.kind === 'service') return serviceDomains(c.serviceId)
    if (c.kind === 'registry') return c.scope === 'host' ? [] : [c.host]
    return c.domains
  })
  // Host services are reached via host.docker.internal, which the proxy rewrites to
  // localhost — so each one needs localhost:<port> in the allowlist to leave the sandbox.
  const hostSvc = spec.hostServices.map((hs) => `localhost:${hs.hostPort}`)
  const tierBase = spec.definition.tier === 'balanced' ? BALANCED_BASELINE : []
  const open = spec.definition.tier === 'open'
  const all = open ? ['**'] : [...tierBase, ...CLAUDE_AGENT_DOMAINS, ...spec.domains, ...svc, ...hostSvc]
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
