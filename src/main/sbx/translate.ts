import type { DefinitionSpec, PortIntent, Tier } from '@shared/types'

export const AGENT_KEYWORD = 'claude'

// A conservative baseline for the "balanced" tier: package registries and
// common developer endpoints an agent typically needs, nothing broader.
export const BALANCED_BASELINE: string[] = [
  'registry.npmjs.org',
  '*.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  '*.githubusercontent.com',
  'api.anthropic.com'
]

/** Normalise an arbitrary definition name into a safe sbx sandbox name. */
export function toSbxName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'sandbox'
}

export function resolveSandboxName(spec: DefinitionSpec): string {
  return toSbxName(spec.definition.name)
}

export function tierToAllowlist(tier: Tier, extraDomains: string[]): string[] {
  if (tier === 'open') return ['**']
  if (tier === 'locked') return dedup(extraDomains)
  return dedup([...BALANCED_BASELINE, ...extraDomains])
}

function dedup(xs: string[]): string[] {
  return [...new Set(xs.filter((x) => x.trim().length > 0))]
}

export function specToCreateArgs(spec: DefinitionSpec): string[] {
  const primary = spec.mounts.find((m) => m.isPrimary) ?? spec.mounts[0]
  const extras = spec.mounts.filter((m) => m !== primary)
  const args = ['create', AGENT_KEYWORD, primary.hostPath]
  for (const m of extras) args.push(m.mode === 'clone' ? `${m.hostPath}:ro` : m.hostPath)
  args.push('--name', resolveSandboxName(spec))
  if (spec.definition.baseImage.trim().length > 0) args.push('--template', spec.definition.baseImage)
  if (primary.mode === 'clone') args.push('--clone')
  return args
}

export function portIntentToPublishSpec(p: PortIntent): string {
  return `${p.hostPort}:${p.containerPort}`
}

/** Single-quote a string for safe embedding in a POSIX shell command. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function agentAttachCommand(name: string): string {
  return `sbx run --name ${shellQuote(name)}`
}

export function hostShellCommand(name: string): string {
  return `sbx exec -it ${shellQuote(name)} bash`
}

// Args matching this are safe to pass unquoted in a shell command; anything
// else (spaces, shell metacharacters like * , etc.) gets single-quoted.
const SAFE_ARG = /^[A-Za-z0-9_./:=+-]+$/

/** Render an argv as a single POSIX shell command string, quoting only what needs it. */
export function shellCommand(argv: string[]): string {
  return argv.map((a) => (SAFE_ARG.test(a) ? a : shellQuote(a))).join(' ')
}

/**
 * The full interactive launch command run in a native terminal:
 *   create (provision) → apply network tier → publish ports → run (attach agent).
 * Chained with `&&` so a failed step stops the sequence and stays visible.
 */
export function launchCommand(spec: DefinitionSpec): string {
  const name = resolveSandboxName(spec)
  const steps: string[] = [shellCommand(['sbx', ...specToCreateArgs(spec)])]
  const resources = tierToAllowlist(spec.definition.tier, spec.domains)
  if (resources.length > 0) {
    steps.push(shellCommand(['sbx', 'policy', 'allow', 'network', '--sandbox', name, resources.join(',')]))
  }
  for (const p of spec.ports) {
    steps.push(shellCommand(['sbx', 'ports', name, '--publish', portIntentToPublishSpec(p)]))
  }
  steps.push(shellCommand(['sbx', 'run', '--name', name]))
  return steps.join(' && ')
}
