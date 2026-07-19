# Ports Step Redesign (v7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the v7 "Publish Ports" design (`brainstorm/mockup/AI Sandbox Manager v7`, wizard step 4) into the app: add **protocol** selection (tcp/tcp4/tcp6), **ephemeral host ports**, and a new **"Access host services from sandbox"** section.

**Architecture:** `PortIntent` gains an optional `hostPort` (null = ephemeral) and a `protocol`. A new `HostServiceIntent` lets the sandbox reach a service on the host via `host.docker.internal:<port>` — the app contributes `localhost:<port>` to the generated kit's `allowedDomains` (the sandbox proxy translates `host.docker.internal` → `localhost`), so it works without a manual allowlist edit. The Ports wizard step becomes two sub-sections. Everything else (launch chain, kit generation) already exists from the credentials work.

**Tech Stack:** Electron (main/preload/renderer), React 18 + TypeScript strict, better-sqlite3, Vitest + @testing-library/react (jsdom), custom i18n.

## Global Constraints

- **Run the full suite with `npm test`, never bare `npx vitest`** — `pretest` flips better-sqlite3 to the Node ABI.
- **`sbx` port spec is `[[HOST_IP:]HOST_PORT:]SANDBOX_PORT[/PROTOCOL]`** (verified via `sbx ports --help`). HOST_PORT first; omit it for an ephemeral host port; `/PROTOCOL` defaults to `tcp`; supported: `tcp, tcp4, tcp6, udp, udp4, udp6`; binds loopback (127.0.0.1 / ::1). The current `hostPort:containerPort` mapping is already correct (host first).
- **Host services are NOT a separate `sbx` command.** They are reachability config: `host.docker.internal:<port>` is available inside the sandbox automatically; the app only needs to allow `localhost:<port>` in the network policy (the proxy rewrites `host.docker.internal` → `localhost`). So a `HostServiceIntent` contributes one `localhost:<port>` entry to `buildKitSpec`'s `allowedDomains`.
- **No secret values involved** — this step is purely port/network config; no vault/keychain concerns.
- **This slice offers only the tcp family** (`tcp`/`tcp4`/`tcp6`) in the protocol select, matching the v7 mockup. udp is representable in the model but not surfaced.

---

## Phase 1 — Shared model

### Task 1: Extend `PortIntent`, add `HostServiceIntent`, extend `DefinitionSpec`

**Files:**
- Modify: `src/shared/types.ts` (`PortIntent`, `DefinitionSpec`)
- Test: `tests/shared/types-ports.test.ts`

**Interfaces (produced):**
```ts
export type PortProtocol = 'tcp' | 'tcp4' | 'tcp6'
export interface PortIntent {
  hostPort: number | null   // null = ephemeral (OS picks the host port)
  containerPort: number
  protocol: PortProtocol
  label: string
}
export interface HostServiceIntent {
  hostPort: number          // a port a service listens on, on the host
  label: string
}
// DefinitionSpec gains:  hostServices: HostServiceIntent[]
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/types-ports.test.ts
import { describe, it, expect } from 'vitest'
import type { PortIntent, HostServiceIntent, DefinitionSpec } from '../../src/shared/types'

describe('port types', () => {
  it('accepts an ephemeral tcp port (null host port)', () => {
    const p: PortIntent = { hostPort: null, containerPort: 3000, protocol: 'tcp', label: '' }
    expect(p.hostPort).toBeNull()
  })
  it('accepts an explicit tcp6 port', () => {
    const p: PortIntent = { hostPort: 8080, containerPort: 3000, protocol: 'tcp6', label: 'web' }
    expect(p.protocol).toBe('tcp6')
  })
  it('accepts a host-service intent and spec.hostServices', () => {
    const hs: HostServiceIntent = { hostPort: 11434, label: 'Ollama' }
    const spec = { hostServices: [hs] } as Pick<DefinitionSpec, 'hostServices'>
    expect(spec.hostServices[0].hostPort).toBe(11434)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `npm test -- types-ports` → FAIL (compile: `protocol`/`hostServices` missing, `hostPort` not nullable).

- [ ] **Step 3: Implement.** In `src/shared/types.ts` replace the `PortIntent` interface and add the new type + field:

```ts
export type PortProtocol = 'tcp' | 'tcp4' | 'tcp6'

export interface PortIntent {
  hostPort: number | null // null = ephemeral (OS allocates the host port)
  containerPort: number
  protocol: PortProtocol
  label: string
}

/** A service on the host the sandbox should reach via host.docker.internal:<port>. */
export interface HostServiceIntent {
  hostPort: number
  label: string
}
```

Add `hostServices: HostServiceIntent[]` to `DefinitionSpec` (after `ports`).

- [ ] **Step 4: Run test + typecheck** — `npm test -- types-ports && npm run typecheck`. The new test PASSES; typecheck now flags `db.ts`, `translate.ts`, `draft.ts`, and port tests (fixed in later tasks). Note them; don't fix yet.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/shared/types-ports.test.ts
git commit -m "feat(ports): PortIntent gains protocol + ephemeral host port; add HostServiceIntent"
```

---

## Phase 2 — Data model

### Task 2: Migrate `port_intent`, add `host_service` table + spec round-trip

**Files:**
- Modify: `src/main/store/db.ts` (SCHEMA, migration, `insertChildren`, `deleteChildren`, `getDefinitionSpec`)
- Test: `tests/main/store/db-ports.test.ts`

**Migration note:** bump `user_version` 3 → 4. `port_intent` needs `protocol TEXT DEFAULT 'tcp'` and `host_port` to allow NULL (ephemeral). SQLite can't drop a NOT NULL constraint in place, so **recreate `port_intent`** (old rows are dev throwaway) and **create `host_service`**. Follow the existing v3 migration pattern (check `PRAGMA table_info` for the new column; if absent, `DROP` + re-`exec(SCHEMA)`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/store/db-ports.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '../../../src/main/store/db'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(id: string): DefinitionSpec {
  return {
    definition: { id, name: 'P', description: '', baseImage: 'i:t', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains: [],
    ports: [
      { hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: 'web' },
      { hostPort: null, containerPort: 9229, protocol: 'tcp6', label: '' }
    ],
    hostServices: [{ hostPort: 11434, label: 'Ollama' }],
    credentials: []
  }
}

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('ports + host services round-trip', () => {
  it('persists and reloads explicit + ephemeral ports with protocol', () => {
    store.insertDefinitionSpec(spec('d1'))
    const back = store.getDefinitionSpec('d1')!
    expect(back.ports).toEqual([
      { hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: 'web' },
      { hostPort: null, containerPort: 9229, protocol: 'tcp6', label: '' }
    ])
    expect(back.hostServices).toEqual([{ hostPort: 11434, label: 'Ollama' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `npm test -- db-ports` → FAIL.

- [ ] **Step 3: Update SCHEMA.** Replace the `port_intent` `CREATE TABLE` and the `PRAGMA user_version` line:

```sql
CREATE TABLE IF NOT EXISTS port_intent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host_port INTEGER,                       -- NULL = ephemeral
  container_port INTEGER NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'tcp',
  label TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS host_service (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host_port INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
PRAGMA user_version = 4;
```

- [ ] **Step 4: Add the v4 migration** after the existing v3 migration block in `openStore`:

```ts
// v3 → v4: port_intent gains `protocol` + nullable host_port; add host_service. Recreate
// port_intent (old rows are dev throwaway — SQLite can't relax NOT NULL in place).
const portCols = (db.prepare(`PRAGMA table_info(port_intent)`).all() as { name: string }[]).map((c) => c.name)
if (!portCols.includes('protocol')) {
  db.exec(`DROP TABLE IF EXISTS port_intent;`)
  db.exec(SCHEMA) // re-creates port_intent (new shape) + host_service
}
```

- [ ] **Step 5: Update `insertChildren`** — the port insert + add host-service insert:

```ts
const pIns = db.prepare(`INSERT INTO port_intent (definition_id, host_port, container_port, protocol, label) VALUES (?,?,?,?,?)`)
for (const p of s.ports) pIns.run(s.definition.id, p.hostPort, p.containerPort, p.protocol, p.label)
const hsIns = db.prepare(`INSERT INTO host_service (definition_id, host_port, label) VALUES (?,?,?)`)
for (const hs of s.hostServices) hsIns.run(s.definition.id, hs.hostPort, hs.label)
```

- [ ] **Step 6: Add `host_service` to `deleteChildren`** — add `'host_service'` to the table list.

- [ ] **Step 7: Update `getDefinitionSpec`** — the ports read + add host-services read:

```ts
const ports = (db.prepare(`SELECT host_port AS hostPort, container_port AS containerPort, protocol, label FROM port_intent WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
  .map((r) => ({ hostPort: r.hostPort === null ? null : Number(r.hostPort), containerPort: Number(r.containerPort), protocol: String(r.protocol) as PortProtocol, label: String(r.label) }))
const hostServices = (db.prepare(`SELECT host_port AS hostPort, label FROM host_service WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
  .map((r) => ({ hostPort: Number(r.hostPort), label: String(r.label) }))
return { definition: def, mounts, domains, ports, hostServices, credentials }
```

Add `PortProtocol` (and `HostServiceIntent` if referenced) to the `@shared/types` import in `db.ts`.

- [ ] **Step 8: Run test + typecheck** — `npm test -- db-ports && npm run typecheck`. `db-ports` PASSES; typecheck still flags `translate.ts`/`draft.ts` (next tasks). Also fix any existing store test that builds a `DefinitionSpec` literal — add `hostServices: []` and `protocol: 'tcp'` to their ports (search `tests/main/store/*.test.ts`, `tests/main/*.test.ts`, `tests/renderer/**` for `containerPort` and `ports:` literals).

- [ ] **Step 9: Commit**

```bash
git add src/main/store/db.ts tests/main/store/db-ports.test.ts
git commit -m "feat(ports): migrate port_intent (protocol + ephemeral) + add host_service store"
```

---

## Phase 3 — Translate + kit (launch wiring)

### Task 3: Publish-spec for protocol/ephemeral; host services → allowlist

**Files:**
- Modify: `src/main/sbx/translate.ts` (`portIntentToPublishSpec`)
- Modify: `src/main/kit/generate.ts` (`allowedDomains` unions host-service `localhost:<port>`)
- Test: `tests/main/sbx/translate-ports.test.ts`, extend `tests/main/kit/generate.test.ts`

**Interfaces:**
- `portIntentToPublishSpec(p: PortIntent): string` → `"[hostPort:]containerPort/protocol"`, e.g. `8080:3000/tcp`, `9229/tcp6` (ephemeral).
- `buildKitSpec` adds `localhost:<hostPort>` to `allowedDomains` for each `spec.hostServices` entry.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/sbx/translate-ports.test.ts
import { describe, it, expect } from 'vitest'
import { portIntentToPublishSpec } from '../../../src/main/sbx/translate'

describe('portIntentToPublishSpec', () => {
  it('explicit host port with protocol', () => {
    expect(portIntentToPublishSpec({ hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: '' })).toBe('8080:3000/tcp')
  })
  it('ephemeral host port omits the host part', () => {
    expect(portIntentToPublishSpec({ hostPort: null, containerPort: 9229, protocol: 'tcp6', label: '' })).toBe('9229/tcp6')
  })
})
```

Add to `tests/main/kit/generate.test.ts`:
```ts
it('allowlists localhost:<port> for each host service', () => {
  const s = spec([], 'locked', [])
  s.hostServices = [{ hostPort: 11434, label: 'Ollama' }]
  const k = buildKitSpec(s)
  expect(k.specYaml).toContain('localhost:11434')
})
```
(Adjust the `spec()` helper in that file to include `hostServices: []` by default.)

- [ ] **Step 2: Run tests to verify they fail** — `npm test -- translate-ports kit/generate` → FAIL.

- [ ] **Step 3: Implement `portIntentToPublishSpec`:**

```ts
export function portIntentToPublishSpec(p: PortIntent): string {
  const host = p.hostPort !== null ? `${p.hostPort}:` : ''
  return `${host}${p.containerPort}/${p.protocol}`
}
```

- [ ] **Step 4: Implement host-service allowlist in `generate.ts`** — in `allowedDomains(spec)`, union `spec.hostServices.map((hs) => 'localhost:' + hs.hostPort)` into the non-open list (so `localhost:<port>` is reachable; `open` tier already allows `**`).

- [ ] **Step 5: Run tests** — `npm test -- translate-ports kit/generate translate-kit` → PASS. (The existing `translate-kit`/`launch` tests build specs with `ports: []`; add `hostServices: []` to any that construct a `DefinitionSpec` literal — the typecheck from Task 1/2 lists them.)

- [ ] **Step 6: Commit**

```bash
git add src/main/sbx/translate.ts src/main/kit/generate.ts tests/main/sbx/translate-ports.test.ts tests/main/kit/generate.test.ts
git commit -m "feat(ports): publish-spec with protocol/ephemeral; host services allowlist localhost:<port>"
```

---

## Phase 4 — Wizard draft model

### Task 4: Draft ports (protocol/ephemeral) + host services + `parsePort`

**Files:**
- Modify: `src/renderer/wizard/draft.ts` (`Draft.ports`, `Draft.hostServices`, actions, reducer, `parsePort`, `toSpec`, `draftFromSpec`)
- Test: `tests/renderer/wizard/draft-ports.test.ts`

**Interfaces:**
- `Draft.ports: { hostPort: number | null; containerPort: number; protocol: PortProtocol; label: string }[]`
- `Draft.hostServices: { hostPort: number; label: string }[]`
- Actions: `addPort` gains `protocol` + nullable `hostPort`; new `addHostService`/`removeHostService`.
- `parsePort(input): { hostPort: number | null; containerPort: number } | null` — accepts `"8080:3000"` (explicit) or `"3000"` (ephemeral → hostPort null). Protocol comes from the UI select, not the text.

- [ ] **Step 1: Write the failing test**

```ts
// tests/renderer/wizard/draft-ports.test.ts
import { describe, it, expect } from 'vitest'
import { draftReducer, initialDraft, parsePort, toSpec } from '../../../src/renderer/wizard/draft'

describe('parsePort', () => {
  it('parses explicit host:container', () => { expect(parsePort('8080:3000')).toEqual({ hostPort: 8080, containerPort: 3000 }) })
  it('parses a bare container port as ephemeral', () => { expect(parsePort('3000')).toEqual({ hostPort: null, containerPort: 3000 }) })
  it('rejects junk', () => { expect(parsePort('nope')).toBeNull() })
})

describe('draft ports + host services', () => {
  const base = { ...initialDraft, workspace: '/p', name: 'p' }
  it('adds an ephemeral tcp6 port', () => {
    const d = draftReducer(base, { type: 'addPort', hostPort: null, containerPort: 9229, protocol: 'tcp6', label: 'dbg' })
    expect(d.ports[0]).toEqual({ hostPort: null, containerPort: 9229, protocol: 'tcp6', label: 'dbg' })
  })
  it('adds and removes a host service, and maps to spec', () => {
    let d = draftReducer(base, { type: 'addHostService', hostPort: 11434, label: 'Ollama' })
    expect(d.hostServices).toEqual([{ hostPort: 11434, label: 'Ollama' }])
    const spec = toSpec(d, 'id1', '2026-07-19T00:00:00.000Z')
    expect(spec.hostServices).toEqual([{ hostPort: 11434, label: 'Ollama' }])
    d = draftReducer(d, { type: 'removeHostService', index: 0 })
    expect(d.hostServices).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `npm test -- draft-ports` → FAIL.

- [ ] **Step 3: Implement.** Update `Draft`:
```ts
ports: { hostPort: number | null; containerPort: number; protocol: PortProtocol; label: string }[]
hostServices: { hostPort: number; label: string }[]
```
`initialDraft`: add `hostServices: []`. Import `PortProtocol` from `@shared/types`.

Actions:
```ts
| { type: 'addPort'; hostPort: number | null; containerPort: number; protocol: PortProtocol; label: string }
| { type: 'removePort'; index: number }
| { type: 'addHostService'; hostPort: number; label: string }
| { type: 'removeHostService'; index: number }
```

Reducer cases:
```ts
case 'addPort': return { ...d, ports: [...d.ports, { hostPort: a.hostPort, containerPort: a.containerPort, protocol: a.protocol, label: a.label }] }
case 'removePort': return { ...d, ports: d.ports.filter((_, i) => i !== a.index) }
case 'addHostService': return { ...d, hostServices: [...d.hostServices, { hostPort: a.hostPort, label: a.label }] }
case 'removeHostService': return { ...d, hostServices: d.hostServices.filter((_, i) => i !== a.index) }
```

`parsePort`:
```ts
export function parsePort(input: string): { hostPort: number | null; containerPort: number } | null {
  const t = input.trim()
  const explicit = t.match(/^(\d+):(\d+)$/)
  if (explicit) return { hostPort: Number(explicit[1]), containerPort: Number(explicit[2]) }
  const bare = t.match(/^(\d+)$/)
  if (bare) return { hostPort: null, containerPort: Number(bare[1]) }
  return null
}
```

`toSpec`: `ports: d.ports` (now carries protocol/nullable) and add `hostServices: d.hostServices`.
`draftFromSpec`: `ports: spec.ports.map((p) => ({ ...p }))` and `hostServices: spec.hostServices.map((hs) => ({ ...hs }))`.

- [ ] **Step 4: Run test + typecheck** — `npm test -- draft-ports && npm run typecheck`. Typecheck now flags `CreateDefinition.tsx` (old ports UI, next task) + existing `draft.test.ts` port literals — update those literals to include `protocol: 'tcp'` and fix `addPort` dispatches.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/wizard/draft.ts tests/renderer/wizard/draft-ports.test.ts
git commit -m "feat(ports): draft model — protocol/ephemeral ports + host services + parsePort"
```

---

## Phase 5 — Ports wizard step UI

### Task 5: Rebuild the Ports step (two sub-sections)

**Files:**
- Create: `src/renderer/wizard/PortsStep.tsx`
- Modify: `src/renderer/wizard/CreateDefinition.tsx` (render `<PortsStep>` at `draft.step === 4`; remove old inline ports UI + `portInput`/`portLabel` state that PortsStep now owns)
- Test: `tests/renderer/wizard/PortsStep.test.tsx`

**Interface:**
```ts
export function PortsStep({ ports, hostServices, onAddPort, onRemovePort, onAddHostService, onRemoveHostService }: {
  ports: { hostPort: number | null; containerPort: number; protocol: PortProtocol; label: string }[]
  hostServices: { hostPort: number; label: string }[]
  onAddPort: (hostPort: number | null, containerPort: number, protocol: PortProtocol, label: string) => void
  onRemovePort: (index: number) => void
  onAddHostService: (hostPort: number, label: string) => void
  onRemoveHostService: (index: number) => void
}): JSX.Element
```

**Layout (mirror v7 mockup lines 1824–1904):**
- Heading uses `t('wizard.steps.ports')` + a subtitle.
- **Section A — "Forward ports into sandbox"** (`t('ports.forwardTitle')` + muted `t('ports.forwardHint')`):
  - List: each port as a row — `port` `→` `container` `/proto`, label (muted), a `t('ports.willForward')` pill, and a ✕ remove. Ephemeral shows the container port with a leading `→` and no host port (e.g. `→ 3000/tcp`).
  - Add form: a mono port input (`aria-label="Port mapping"`, placeholder `t('ports.portPlaceholder')` = `e.g. 8080:3000  or just 3000`), a **protocol** `<select aria-label="Protocol">` (TCP/TCP4/TCP6 → values `tcp`/`tcp4`/`tcp6`), a label input, and **Add** → `parsePort` the text; on success `onAddPort(hostPort, containerPort, protocol, label)`.
  - Help box `t('ports.howItWorks')` (the 5 bullets — ephemeral, `host:container`, `/tcp4`/`/tcp6`, binds 127.0.0.1, survives restarts).
- **Section B — "Access host services from sandbox"** (`t('ports.hostTitle')` + muted `t('ports.hostHint')`):
  - Explanatory paragraph `t('ports.hostDesc')` (host.docker.internal + localhost allowlist).
  - List: each host service — `host.docker.internal:<port>`, label (muted), status `t('ports.allowlist', { port })` = `Allowlist: localhost:<port>`, ✕ remove.
  - Add form: numeric host-port input (`aria-label="Host port"`), a service-name input, **Add** → `onAddHostService(Number(port), name)`.
  - Warning box `t('ports.hostWarning')` (styled with the warning tokens + a triangle icon, per the mockup).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/renderer/wizard/PortsStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortsStep } from '../../../src/renderer/wizard/PortsStep'

type Props = Parameters<typeof PortsStep>[0]
function setup(over: Partial<Props> = {}) {
  const props: Props = { ports: [], hostServices: [], onAddPort: vi.fn(), onRemovePort: vi.fn(), onAddHostService: vi.fn(), onRemoveHostService: vi.fn(), ...over }
  render(<PortsStep {...props} />)
  return props
}

describe('PortsStep', () => {
  it('adds an explicit port with the selected protocol', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText('Port mapping'), { target: { value: '8080:3000' } })
    fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'tcp6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddPort).toHaveBeenCalledWith(8080, 3000, 'tcp6', '')
  })
  it('adds a bare port as ephemeral (null host port)', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText('Port mapping'), { target: { value: '3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddPort).toHaveBeenCalledWith(null, 3000, 'tcp', '')
  })
  it('adds a host service and shows the allowlist hint', () => {
    const p = setup({ hostServices: [{ hostPort: 11434, label: 'Ollama' }] })
    expect(screen.getByText(/localhost:11434/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Host port'), { target: { value: '5432' } })
    fireEvent.click(screen.getByRole('button', { name: /add host/i }))
    expect(p.onAddHostService).toHaveBeenCalledWith(5432, '')
  })
})
```

> Give the two Add buttons distinct accessible names so the tests aren't ambiguous — e.g. the forward-ports button reads `Add`, the host-service button `Add host service` (or an `aria-label`). Adjust the port-list row / host-list row markup to the mockup while keeping these hooks.

- [ ] **Step 2: Run test to verify it fails** — `npm test -- PortsStep` → FAIL.

- [ ] **Step 3: Implement `PortsStep`** per the layout above, using the existing wizard input classes and the mockup markup (`brainstorm/mockup/AI Sandbox Manager v7` lines 1824–1904). Protocol select values are `tcp`/`tcp4`/`tcp6`.

- [ ] **Step 4: Wire into `CreateDefinition.tsx`** — replace the `draft.step === 4` block with:
```tsx
{draft.step === 4 && (
  <PortsStep
    ports={draft.ports}
    hostServices={draft.hostServices}
    onAddPort={(hostPort, containerPort, protocol, label) => dispatch({ type: 'addPort', hostPort, containerPort, protocol, label })}
    onRemovePort={(index) => dispatch({ type: 'removePort', index })}
    onAddHostService={(hostPort, label) => dispatch({ type: 'addHostService', hostPort, label })}
    onRemoveHostService={(index) => dispatch({ type: 'removeHostService', index })}
  />
)}
```
Remove the now-unused `portInput`/`portLabel` state and the old inline ports JSX. Import `PortsStep`.

- [ ] **Step 5: Run test to verify it passes** — `npm test -- PortsStep` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/wizard/PortsStep.tsx src/renderer/wizard/CreateDefinition.tsx tests/renderer/wizard/PortsStep.test.tsx
git commit -m "feat(ports): rebuild Ports step — forward ports (protocol) + host services (v7)"
```

---

## Phase 6 — Review step

### Task 6: Summarise ports + host services in Review

**Files:**
- Modify: `src/renderer/wizard/CreateDefinition.tsx` (review table)
- Test: extend `tests/renderer/wizard/CreateDefinition.test.tsx`

- [ ] **Step 1:** Update the review row for ports to render a summary, e.g. `8080→3000/tcp, →9229/tcp6` (ephemeral shown with a leading `→`), and **add a host-services row** (`t('wizard.reviewHostServices')`) listing `host.docker.internal:<port>` entries (or the count). Reuse a small `portsSummary(ports)` / `hostServicesSummary(hostServices)` helper near `credentialsSummary`.

- [ ] **Step 2:** Extend the existing "walks to the review step" test to assert the ports summary renders when a port was added. Run `npm test -- CreateDefinition` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/wizard/CreateDefinition.tsx tests/renderer/wizard/CreateDefinition.test.tsx
git commit -m "feat(ports): summarise ports + host services in the Review step"
```

---

## Phase 7 — i18n

### Task 7: Add `ports.*` strings (en + de) and wire them

**Files:**
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`

Add a `ports` namespace covering: `forwardTitle`, `forwardHint`, `willForward`, `portPlaceholder`, `protocol`, `add`, `remove`, `howItWorks` (or individual bullet keys), `hostTitle`, `hostHint`, `hostDesc`, `allowlist` (`'Allowlist: localhost:{port}'`), `hostPortPlaceholder`, `serviceNamePlaceholder`, `addHostService`, `hostWarning`. Also add `wizard.reviewHostServices`. Keep `de: Dict` parity (typecheck enforces it).

- [ ] **Step 1:** Add keys to `en.ts`, translate to `de.ts`, and replace the literal strings in `PortsStep.tsx` with `t('ports.*')` (keep `aria-label`s literal where tests assert them). Run `npm run typecheck` (Dict parity) → clean.
- [ ] **Step 2:** `npm test` → all PASS.
- [ ] **Step 3: Commit**

```bash
git add src/renderer/i18n/en.ts src/renderer/i18n/de.ts src/renderer/wizard/PortsStep.tsx
git commit -m "i18n(ports): add ports/host-service strings (en/de)"
```

---

## Phase 8 — Finalize

### Task 8: Green suite + build + manual check

- [ ] **Step 1:** `npm test` → all PASS (fix any remaining `DefinitionSpec`/`PortIntent` literal in tests missing `protocol`/`hostServices`).
- [ ] **Step 2:** `npm run typecheck && npm run build` → clean.
- [ ] **Step 3: Manual check** — `npm run dev` (full restart, main changed): create a definition, add an explicit port (`8080:3000`, TCP6), an ephemeral port (`3000`), and a host service (`11434` Ollama). Launch. Confirm the terminal command contains `sbx ports <name> --publish 8080:3000/tcp6` and `--publish 3000/tcp`, and the generated `<workspace>/.sandbox/kit/spec.yaml` `allowedDomains` includes `localhost:11434`. Once running, `sbx ports <name>` lists the forwards.
- [ ] **Step 4:** Use superpowers:finishing-a-development-branch to complete.

---

## Self-Review

**Spec coverage (v7 Ports step):** protocol select → Tasks 1,4,5. Ephemeral host port → Tasks 1,3,4,5. Forward-ports list + help → Task 5. Host-services section (host.docker.internal + localhost allowlist) → Tasks 1,2,3,5, with the allowlist auto-wired in `buildKitSpec` (Task 3) — an improvement over the mockup's manual-allowlist instruction, surfaced via the "Allowlist: localhost:<port>" status label. Review summary → Task 6. i18n → Task 7.

**Type consistency:** `PortProtocol` = `'tcp'|'tcp4'|'tcp6'` defined once (Task 1), consumed identically in db/translate/draft/UI. `hostPort: number | null` (null = ephemeral) throughout. `HostServiceIntent { hostPort; label }` and `DefinitionSpec.hostServices` used consistently. `portIntentToPublishSpec` output `[host:]container/proto`.

**Known risks:** existing tests build `DefinitionSpec`/`PortIntent` literals without `protocol`/`hostServices` — Tasks 2/3/4/8 call out updating them (search for `containerPort` and `ports:`). SQLite NOT-NULL relaxation forces a `port_intent` recreate (dev-safe). udp protocols are modelled-representable but intentionally not surfaced in the select.

---

## Execution Handoff

Two options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between.
2. **Inline Execution** — batch with checkpoints.

Which approach?
