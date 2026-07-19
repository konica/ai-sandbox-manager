import type { Store } from '../store/db'
import type { LivePort, HostServiceIntent, DefinitionSpec, PortProtocol } from '@shared/types'

type Op = 'add' | 'remove'

// Resolve the instance's definition spec (or null when the instance isn't linked to one).
function specFor(store: Store, sbxName: string): DefinitionSpec | null {
  const meta = store.listInstanceMeta().find((m) => m.sbxName === sbxName)
  if (!meta?.definitionId) return null
  return store.getDefinitionSpec(meta.definitionId)
}

function samePort(a: { hostPort: number | null; containerPort: number; protocol: string }, b: LivePort): boolean {
  return a.hostPort === b.hostPort && a.containerPort === b.containerPort && a.protocol === b.protocol
}

/**
 * Dual-write helpers: apply a live edit back to the instance's definition so the next
 * kit regen includes it. Return false (no-op) when the instance has no linked definition.
 */
export function applyPortEdit(store: Store, sbxName: string, port: LivePort, op: Op): boolean {
  const spec = specFor(store, sbxName)
  if (!spec) return false
  if (op === 'add') {
    if (spec.ports.some((p) => samePort(p, port))) return true
    spec.ports = [...spec.ports, { hostPort: port.hostPort, containerPort: port.containerPort, protocol: port.protocol as PortProtocol, label: '' }]
  } else {
    spec.ports = spec.ports.filter((p) => !samePort(p, port))
  }
  store.updateDefinitionSpec(spec)
  return true
}

export function applyHostServiceEdit(store: Store, sbxName: string, hs: HostServiceIntent, op: Op): boolean {
  const spec = specFor(store, sbxName)
  if (!spec) return false
  if (op === 'add') {
    if (spec.hostServices.some((h) => h.hostPort === hs.hostPort)) return true
    spec.hostServices = [...spec.hostServices, { hostPort: hs.hostPort, label: hs.label }]
  } else {
    spec.hostServices = spec.hostServices.filter((h) => h.hostPort !== hs.hostPort)
  }
  store.updateDefinitionSpec(spec)
  return true
}

export function applyDomainEdit(store: Store, sbxName: string, domain: string, op: Op): boolean {
  const spec = specFor(store, sbxName)
  if (!spec) return false
  if (op === 'add') {
    if (spec.domains.includes(domain)) return true
    spec.domains = [...spec.domains, domain]
  } else {
    spec.domains = spec.domains.filter((d) => d !== domain)
  }
  store.updateDefinitionSpec(spec)
  return true
}
