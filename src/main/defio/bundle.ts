import type { DefinitionSpec } from '@shared/types'
import { AGENT_PROFILES, agentFromBaseImage } from '@shared/agents'
import type { AgentId } from '@shared/agents'

export type ExportableDefinition = Omit<DefinitionSpec, 'definition'> & {
  definition: Omit<DefinitionSpec['definition'], 'id' | 'createdAt'>
}
export interface DefinitionBundle {
  formatVersion: '1'
  kind: 'sandbox-definitions'
  exportedAt: string
  definitions: ExportableDefinition[]
}
export class BundleError extends Error {}

/** Wrap specs in the shareable envelope, dropping id/createdAt (regenerated on import).
 * Secret-free by construction: the spec's credentials are refs with no values. */
export function buildExportBundle(specs: DefinitionSpec[], now: string): DefinitionBundle {
  return {
    formatVersion: '1',
    kind: 'sandbox-definitions',
    exportedAt: now,
    definitions: specs.map((s) => {
      const { id: _id, createdAt: _createdAt, ...definition } = s.definition
      return { ...s, definition }
    })
  }
}

/** An imported bundle is untrusted input: accept `agent` only if it names a real profile,
 * else fall back to deriving it from the image ref (which itself defaults to 'claude'). */
function normalizeAgent(raw: unknown, baseImage: string): AgentId {
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(AGENT_PROFILES, raw)) {
    return raw as AgentId
  }
  return agentFromBaseImage(baseImage)
}

// A definition entry is usable when it has the required scalar fields; array fields
// default to [] so an older/partial export still imports.
function normalizeEntry(raw: unknown): ExportableDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const def = e.definition as Record<string, unknown> | undefined
  if (!def || typeof def.name !== 'string' || !def.name.trim() || typeof def.baseImage !== 'string' || typeof def.tier !== 'string') return null
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    definition: {
      name: def.name,
      description: typeof def.description === 'string' ? def.description : '',
      agent: normalizeAgent(def.agent, def.baseImage),
      baseImage: def.baseImage,
      tier: def.tier as DefinitionSpec['definition']['tier']
    },
    mounts: arr(e.mounts), domains: arr(e.domains), ports: arr(e.ports),
    hostServices: arr(e.hostServices), credentials: arr(e.credentials),
    ssh: (e.ssh && typeof e.ssh === 'object' ? e.ssh : undefined) as ExportableDefinition['ssh'],
    kitCommandsYaml: typeof e.kitCommandsYaml === 'string' ? e.kitCommandsYaml : undefined
  }
}

/** Parse + validate a bundle. Throws BundleError on bad envelope; skips malformed entries. */
export function parseImportBundle(jsonText: string): { definitions: ExportableDefinition[]; skipped: number } {
  let parsed: unknown
  try { parsed = JSON.parse(jsonText) } catch { throw new BundleError('Not valid JSON') }
  const b = parsed as Record<string, unknown>
  if (!b || b.formatVersion !== '1' || b.kind !== 'sandbox-definitions' || !Array.isArray(b.definitions)) {
    throw new BundleError('Not a valid .sbx.json definition bundle')
  }
  const definitions: ExportableDefinition[] = []
  let skipped = 0
  for (const raw of b.definitions) {
    const e = normalizeEntry(raw)
    if (e) definitions.push(e)
    else skipped++
  }
  return { definitions, skipped }
}

/** "Foo" taken → "Foo (imported)"; that taken → "Foo (imported 2)" … */
export function dedupeName(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name
  let candidate = `${name} (imported)`
  let n = 2
  while (existing.has(candidate)) candidate = `${name} (imported ${n++})`
  return candidate
}
