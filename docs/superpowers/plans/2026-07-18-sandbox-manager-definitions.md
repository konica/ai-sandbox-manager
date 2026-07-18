# AI Sandbox Manager — Phase 2: Definitions & Create-Definition Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a developer author a reusable **Sandbox Definition** (base image, workspace + extra folders with mount modes, network tier + allowlist, published-port intents, credential declarations) through a 7-step wizard, persist it to SQLite, and see it listed on a Definitions screen. No launching yet.

**Architecture:** Builds directly on the Phase 1 walking skeleton (Electron main + React renderer, `#metadata-store`, IPC bridge). Extends the SQLite schema (v1→v2) with child tables hanging off `definition` (`mount_intent`, `policy_domain`, `port_intent`, `credential_ref`), adds a `DefinitionSpec` composite persisted atomically in a transaction, two IPC channels (`def:create`, `def:list`), a pure wizard-draft reducer (all form/validation logic, unit-tested in isolation), the wizard UI (7 steps), a Definitions list screen, and a minimal nav shell so the renderer can move between Definitions, the wizard, and Instances.

**Tech Stack:** Same as Phase 1 — Electron, electron-vite, React 18, TypeScript (strict), better-sqlite3, Vitest, @testing-library/react. No new dependencies.

## Global Constraints

- **No secret values in SQLite or the sandbox filesystem, ever.** The wizard's Credentials step captures only credential **declarations** (a label + a kind such as `git`/`api-key`/`claude-auth`) as `credential_ref` rows. Capturing and storing actual secret **values** (keychain / `sbx secret set`) is **Phase 6** and is explicitly out of scope here. No table added in this phase has a value column.
- **`sbx` is the source of truth** for instances; definitions are app-owned specs. Creating a definition performs **no `sbx` call** and creates no sandbox.
- **Agent is fixed to "Claude Code."** The base image must be a `claude-code*` variant (default `docker/sandbox-templates:claude-code-docker`) or a custom template ref derived from one.
- **Default network tier is Locked Down.** New definitions start on `locked`.
- **Mount modes are exactly two:** `direct` (read-write) or `clone` (read-only). Direct mode must show the implicit-execution-file warning (git hooks, CI config, Makefiles).
- **Ports are intents only** at definition time (Docker forbids publishing at create). This phase persists intents; it never forwards a port.
- **TypeScript strict mode**; shared types in `src/shared/`. IPC results keep the Phase 1 shape `{ ok: true; data: T } | { ok: false; error: { kind; message } }`.
- **Commit after every task.** Work continues on the `main` branch established at the end of Phase 1.
- **Design tokens** already frozen in `src/renderer/theme/tokens.css` (Phase 1); reuse them, add none.

## Existing interfaces this phase builds on (Phase 1, do not redefine)

- `src/shared/types.ts`: `Tier = 'open'|'balanced'|'locked'`, `Definition { id; name; description; baseImage; tier; createdAt }`, `Result<T>`, `InstanceView`.
- `src/main/store/db.ts`: `interface Store { insertDefinition; listDefinitions; getDefinition; upsertInstanceMeta; listInstanceMeta; deleteInstanceMeta; close }`, `openStore(filename): Store`. Schema currently `PRAGMA user_version = 1`.
- `src/main/ipc.ts`: `buildHandlers({ adapter, store, probes })` returning `{ 'prereq:check'; 'instances:list' }`; `registerIpc(deps)`.
- `src/preload/index.ts`: `window.api = { prereqCheck, instancesList }`.
- `src/renderer/ipc/client.ts`: `export const api` typed wrapper with a test fallback.
- `src/renderer/App.tsx`: prereq gate → renders `Prereq` or `Instances`.

---

## File Structure (Phase 2)

```
src/shared/types.ts                    MODIFY: add MountMode, MountIntent, PortIntent,
                                               CredentialKind, CredentialRef, DefinitionSpec
src/main/store/db.ts                   MODIFY: schema v2 child tables; insertDefinitionSpec,
                                               getDefinitionSpec
src/main/ipc.ts                        MODIFY: add def:create, def:list handlers
src/preload/index.ts                   MODIFY: expose defCreate, defList
src/renderer/ipc/client.ts             MODIFY: add defCreate, defList to Api + fallback
src/renderer/wizard/draft.ts           CREATE: pure draft reducer + validation + toSpec
src/renderer/wizard/CreateDefinition.tsx CREATE: 7-step wizard component
src/renderer/wizard/steps/             CREATE: Step1Name, Step2Image, Step3Workspace,
                                               Step4Network, Step5Ports, Step6Credentials, Step7Review
src/renderer/screens/Definitions.tsx   CREATE: definitions list + empty state + create button
src/renderer/components/NavShell.tsx   CREATE: sidebar nav (Definitions / Instances)
src/renderer/App.tsx                   MODIFY: nav state machine across screens + wizard
tests/main/store/definition-spec.test.ts   CREATE
tests/main/ipc-definitions.test.ts         CREATE
tests/renderer/wizard/draft.test.ts        CREATE
tests/renderer/Definitions.test.tsx        CREATE
tests/renderer/wizard/CreateDefinition.test.tsx CREATE
tests/renderer/App.nav.test.tsx            CREATE
```

---

### Task 1: Data model — `DefinitionSpec` types + schema v2 + store persistence

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/store/db.ts`
- Test: `tests/main/store/definition-spec.test.ts`

**Interfaces:**
- Consumes: existing `Definition`, `Tier` from Phase 1.
- Produces (in `src/shared/types.ts`):
  - `type MountMode = 'direct' | 'clone'`
  - `interface MountIntent { hostPath: string; mode: MountMode; isPrimary: boolean }`
  - `interface PortIntent { hostPort: number; containerPort: number; label: string }`
  - `type CredentialKind = 'git' | 'api-key' | 'claude-auth'`
  - `interface CredentialRef { label: string; kind: CredentialKind }`
  - `interface DefinitionSpec { definition: Definition; mounts: MountIntent[]; domains: string[]; ports: PortIntent[]; credentials: CredentialRef[] }`
- Produces (added to `interface Store`):
  - `insertDefinitionSpec(spec: DefinitionSpec): void` — one transaction; inserts the `definition` row plus all child rows.
  - `getDefinitionSpec(id: string): DefinitionSpec | null` — reads the definition and all child rows back into a `DefinitionSpec`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/store/definition-spec.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '@main/store/db'
import type { DefinitionSpec } from '@shared/types'

let store: Store
beforeEach(() => { store = openStore(':memory:') })

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'prj-alpha', description: 'Alpha service', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' },
  mounts: [
    { hostPath: '/home/u/alpha', mode: 'direct', isPrimary: true },
    { hostPath: '/home/u/shared', mode: 'clone', isPrimary: false }
  ],
  domains: ['api.github.com', 'registry.npmjs.org'],
  ports: [{ hostPort: 8080, containerPort: 3000, label: 'web' }],
  credentials: [{ label: 'GitHub token', kind: 'git' }]
}

describe('definition spec persistence', () => {
  it('round-trips a full spec', () => {
    store.insertDefinitionSpec(spec)
    const got = store.getDefinitionSpec('d1')
    expect(got).toEqual(spec)
  })

  it('returns null for an unknown id', () => {
    expect(store.getDefinitionSpec('missing')).toBeNull()
  })

  it('lists the definition base row alongside instance metadata queries', () => {
    store.insertDefinitionSpec(spec)
    expect(store.listDefinitions().map((d) => d.id)).toContain('d1')
  })

  it('persists an empty-children spec', () => {
    const bare: DefinitionSpec = {
      definition: { id: 'd2', name: 'bare', description: '', baseImage: 'docker/sandbox-templates:claude-code', tier: 'open', createdAt: '2026-07-18T00:00:00Z' },
      mounts: [], domains: [], ports: [], credentials: []
    }
    store.insertDefinitionSpec(bare)
    expect(store.getDefinitionSpec('d2')).toEqual(bare)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/main/store/definition-spec.test.ts --reporter=dot`
Expected: FAIL — `insertDefinitionSpec`/`getDefinitionSpec` do not exist and `DefinitionSpec` is not exported.

(Note: this repo's shell filters plain `vitest` output; prefix commands with `rtk proxy` to see results, as in Phase 1.)

- [ ] **Step 3: Add the shared types**

In `src/shared/types.ts`, append after the existing `Definition` interface:

```ts
export type MountMode = 'direct' | 'clone'

export interface MountIntent {
  hostPath: string
  mode: MountMode
  isPrimary: boolean
}

export interface PortIntent {
  hostPort: number
  containerPort: number
  label: string
}

export type CredentialKind = 'git' | 'api-key' | 'claude-auth'

export interface CredentialRef {
  label: string
  kind: CredentialKind
}

export interface DefinitionSpec {
  definition: Definition
  mounts: MountIntent[]
  domains: string[]
  ports: PortIntent[]
  credentials: CredentialRef[]
}
```

- [ ] **Step 4: Extend the schema and store**

In `src/main/store/db.ts`, update the `SCHEMA` constant to add the child tables and bump the version. Replace the `PRAGMA user_version = 1;` line and add tables above it:

```ts
CREATE TABLE IF NOT EXISTS mount_intent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS policy_domain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host TEXT NOT NULL,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS port_intent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  host_port INTEGER NOT NULL,
  container_port INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS credential_ref (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
PRAGMA user_version = 2;
```

Update the import line and add the two methods. Change the import at the top:

```ts
import type { Definition, InstanceMeta, DefinitionSpec, MountMode, CredentialKind } from '@shared/types'
```

Add to the `Store` interface (after `getDefinition`):

```ts
  insertDefinitionSpec(spec: DefinitionSpec): void
  getDefinitionSpec(id: string): DefinitionSpec | null
```

Inside `openStore`, after the existing `getDefinition` method implementation, add:

```ts
    insertDefinitionSpec(spec) {
      const insertAll = db.transaction((s: DefinitionSpec) => {
        db.prepare(
          `INSERT INTO definition (id, name, description, base_image, tier, created_at)
           VALUES (@id, @name, @description, @baseImage, @tier, @createdAt)`
        ).run(s.definition)
        const mIns = db.prepare(`INSERT INTO mount_intent (definition_id, host_path, mode, is_primary) VALUES (?, ?, ?, ?)`)
        for (const m of s.mounts) mIns.run(s.definition.id, m.hostPath, m.mode, m.isPrimary ? 1 : 0)
        const dIns = db.prepare(`INSERT INTO policy_domain (definition_id, host) VALUES (?, ?)`)
        for (const host of s.domains) dIns.run(s.definition.id, host)
        const pIns = db.prepare(`INSERT INTO port_intent (definition_id, host_port, container_port, label) VALUES (?, ?, ?, ?)`)
        for (const p of s.ports) pIns.run(s.definition.id, p.hostPort, p.containerPort, p.label)
        const cIns = db.prepare(`INSERT INTO credential_ref (definition_id, label, kind) VALUES (?, ?, ?)`)
        for (const c of s.credentials) cIns.run(s.definition.id, c.label, c.kind)
      })
      insertAll(spec)
    },
    getDefinitionSpec(id) {
      const def = this.getDefinition(id)
      if (!def) return null
      const mounts = (db.prepare(`SELECT host_path AS hostPath, mode, is_primary AS isPrimary FROM mount_intent WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPath: String(r.hostPath), mode: String(r.mode) as MountMode, isPrimary: r.isPrimary === 1 }))
      const domains = (db.prepare(`SELECT host FROM policy_domain WHERE definition_id = ? ORDER BY id`).all(id) as Array<{ host: string }>).map((r) => r.host)
      const ports = (db.prepare(`SELECT host_port AS hostPort, container_port AS containerPort, label FROM port_intent WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ hostPort: Number(r.hostPort), containerPort: Number(r.containerPort), label: String(r.label) }))
      const credentials = (db.prepare(`SELECT label, kind FROM credential_ref WHERE definition_id = ? ORDER BY id`).all(id) as Array<Record<string, unknown>>)
        .map((r) => ({ label: String(r.label), kind: String(r.kind) as CredentialKind }))
      return { definition: def, mounts, domains, ports, credentials }
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/main/store/definition-spec.test.ts --reporter=dot`
Expected: PASS (4 tests). Then run the existing store test to confirm no regression: `rtk proxy npx vitest run tests/main/store/db.test.ts --reporter=dot` → PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(store): persist DefinitionSpec (schema v2 child tables + transaction)"
```

---

### Task 2: IPC — `def:create` and `def:list`

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/ipc/client.ts`
- Test: `tests/main/ipc-definitions.test.ts`

**Interfaces:**
- Consumes: `Store.insertDefinitionSpec`, `Store.listDefinitions` (Task 1 / Phase 1), `DefinitionSpec`, `Definition`, `Result<T>`.
- Produces:
  - `buildHandlers` return type gains `'def:create': (spec: DefinitionSpec) => Promise<Result<{ id: string }>>` and `'def:list': () => Promise<Result<Definition[]>>`.
  - `window.api` gains `defCreate(spec: DefinitionSpec): Promise<Result<{ id: string }>>` and `defList(): Promise<Result<Definition[]>>`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/ipc-definitions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))

import { buildHandlers } from '@main/ipc'
import { openStore } from '@main/store/db'
import type { SbxAdapter } from '@main/sbx/adapter'
import type { Probes } from '@main/prereq'
import type { DefinitionSpec } from '@shared/types'

const adapter: SbxAdapter = {
  runSbx: async () => ({ stdout: '', stderr: '', code: 0 }),
  listSandboxes: async () => []
}
const probes: Probes = {
  hasDocker: async () => true, sbxVersion: async () => 'sbx 1.0', sbxAuthed: async () => true,
  freeDiskBytes: async () => 50 * 1024 ** 3, keychainReachable: async () => true
}

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'prj-alpha', description: '', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' },
  mounts: [], domains: [], ports: [], credentials: []
}

describe('definition IPC handlers', () => {
  it('def:create persists the spec and returns its id', async () => {
    const store = openStore(':memory:')
    const h = buildHandlers({ adapter, store, probes })
    const res = await h['def:create'](spec)
    expect(res).toEqual({ ok: true, data: { id: 'd1' } })
    expect(store.getDefinitionSpec('d1')).not.toBeNull()
  })

  it('def:list returns the persisted definitions', async () => {
    const store = openStore(':memory:')
    const h = buildHandlers({ adapter, store, probes })
    await h['def:create'](spec)
    const res = await h['def:list']()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.map((d) => d.name)).toEqual(['prj-alpha'])
  })

  it('def:create wraps failures as {ok:false}', async () => {
    const store = openStore(':memory:')
    const h = buildHandlers({ adapter, store, probes })
    await h['def:create'](spec)
    const dup = await h['def:create'](spec) // duplicate primary key
    expect(dup.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/main/ipc-definitions.test.ts --reporter=dot`
Expected: FAIL — `def:create`/`def:list` not on the handler map.

- [ ] **Step 3: Add the handlers**

In `src/main/ipc.ts`, extend the imports:

```ts
import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition } from '@shared/types'
```

Change the `buildHandlers` return type and body to include the two channels:

```ts
export function buildHandlers(deps: Deps): {
  'prereq:check': () => Promise<Result<PrereqResult>>
  'instances:list': () => Promise<Result<InstanceView[]>>
  'def:create': (spec: DefinitionSpec) => Promise<Result<{ id: string }>>
  'def:list': () => Promise<Result<Definition[]>>
} {
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(() => reconcile(deps.adapter, deps.store)),
    'def:create': (spec) => wrap(async () => { deps.store.insertDefinitionSpec(spec); return { id: spec.definition.id } }),
    'def:list': () => wrap(async () => deps.store.listDefinitions())
  }
}
```

Update `registerIpc` so channels that take an argument forward it. Replace the loop body:

```ts
export function registerIpc(deps: Deps): void {
  const handlers = buildHandlers(deps)
  ipcMain.handle('prereq:check', () => handlers['prereq:check']())
  ipcMain.handle('instances:list', () => handlers['instances:list']())
  ipcMain.handle('def:create', (_e, spec: DefinitionSpec) => handlers['def:create'](spec))
  ipcMain.handle('def:list', () => handlers['def:list']())
}
```

- [ ] **Step 4: Expose in preload + client**

In `src/preload/index.ts`, extend `api`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { DefinitionSpec } from '@shared/types'

const api = {
  prereqCheck: () => ipcRenderer.invoke('prereq:check'),
  instancesList: () => ipcRenderer.invoke('instances:list'),
  defCreate: (spec: DefinitionSpec) => ipcRenderer.invoke('def:create', spec),
  defList: () => ipcRenderer.invoke('def:list')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

In `src/renderer/ipc/client.ts`, extend the `Api` interface and fallback:

```ts
import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition } from '@shared/types'

interface Api {
  prereqCheck(): Promise<Result<PrereqResult>>
  instancesList(): Promise<Result<InstanceView[]>>
  defCreate(spec: DefinitionSpec): Promise<Result<{ id: string }>>
  defList(): Promise<Result<Definition[]>>
}

export const api: Api = (globalThis as unknown as { api?: Api }).api ?? {
  prereqCheck: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancesList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defCreate: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  defList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/main/ipc-definitions.test.ts tests/main/ipc.test.ts --reporter=dot`
Expected: PASS (3 new + 3 existing).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ipc): add def:create and def:list channels"
```

---

### Task 3: Wizard draft reducer (pure form + validation logic)

**Files:**
- Create: `src/renderer/wizard/draft.ts`
- Test: `tests/renderer/wizard/draft.test.ts`

**Interfaces:**
- Consumes: `Tier`, `MountMode`, `CredentialKind`, `DefinitionSpec`, `Definition` (shared types).
- Produces:
  - `type BuiltinVariant = 'claude-code-docker' | 'claude-code' | 'claude-code-minimal'`
  - `interface Draft { step: number; name: string; description: string; imageChoice: BuiltinVariant | 'custom'; customImageRef: string; workspace: string; workspaceMode: MountMode; extraFolders: { path: string; mode: MountMode }[]; tier: Tier; domains: string[]; ports: { hostPort: number; containerPort: number; label: string }[]; credentials: { label: string; kind: CredentialKind }[] }`
  - `const initialDraft: Draft`
  - `type DraftAction` (discriminated union — see implementation)
  - `function draftReducer(d: Draft, a: DraftAction): Draft`
  - `function resolveBaseImage(d: Draft): string` — variant → `docker/sandbox-templates:<variant>`; `custom` → `customImageRef.trim()`.
  - `function parsePort(input: string): { hostPort: number; containerPort: number } | null` — `"8080:3000"` → `{8080,3000}`; invalid → null.
  - `function canAdvance(d: Draft): boolean` — step 1 requires non-empty name; step 2 requires a resolved base image; step 3 requires a workspace path; steps 4-7 always true.
  - `function toSpec(d: Draft, id: string, createdAt: string): DefinitionSpec` — builds the composite (workspace becomes a primary `MountIntent`; extra folders become non-primary).
  - `const TOTAL_STEPS = 7`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/wizard/draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { initialDraft, draftReducer, resolveBaseImage, parsePort, canAdvance, toSpec } from '../../../src/renderer/wizard/draft'

describe('parsePort', () => {
  it('parses host:container', () => { expect(parsePort('8080:3000')).toEqual({ hostPort: 8080, containerPort: 3000 }) })
  it('rejects malformed input', () => {
    expect(parsePort('8080')).toBeNull()
    expect(parsePort('a:b')).toBeNull()
    expect(parsePort('')).toBeNull()
  })
})

describe('resolveBaseImage', () => {
  it('maps a builtin variant to a template ref', () => {
    expect(resolveBaseImage({ ...initialDraft, imageChoice: 'claude-code-docker' })).toBe('docker/sandbox-templates:claude-code-docker')
  })
  it('uses the custom ref verbatim when custom is chosen', () => {
    expect(resolveBaseImage({ ...initialDraft, imageChoice: 'custom', customImageRef: 'docker.io/acme/img:1' })).toBe('docker.io/acme/img:1')
  })
})

describe('canAdvance', () => {
  it('blocks step 1 without a name', () => {
    expect(canAdvance({ ...initialDraft, step: 1, name: '' })).toBe(false)
    expect(canAdvance({ ...initialDraft, step: 1, name: 'x' })).toBe(true)
  })
  it('blocks step 3 without a workspace', () => {
    expect(canAdvance({ ...initialDraft, step: 3, workspace: '' })).toBe(false)
    expect(canAdvance({ ...initialDraft, step: 3, workspace: '/w' })).toBe(true)
  })
})

describe('draftReducer', () => {
  it('advances and retreats steps', () => {
    let d = { ...initialDraft, name: 'x' }
    d = draftReducer(d, { type: 'next' })
    expect(d.step).toBe(2)
    d = draftReducer(d, { type: 'back' })
    expect(d.step).toBe(1)
  })
  it('does not advance past the last step or before the first', () => {
    expect(draftReducer({ ...initialDraft, step: 7 }, { type: 'next' }).step).toBe(7)
    expect(draftReducer({ ...initialDraft, step: 1 }, { type: 'back' }).step).toBe(1)
  })
  it('adds and removes domains', () => {
    let d = draftReducer(initialDraft, { type: 'addDomain', host: 'api.github.com' })
    expect(d.domains).toEqual(['api.github.com'])
    d = draftReducer(d, { type: 'addDomain', host: 'api.github.com' }) // dedupe
    expect(d.domains).toEqual(['api.github.com'])
    d = draftReducer(d, { type: 'removeDomain', host: 'api.github.com' })
    expect(d.domains).toEqual([])
  })
  it('adds and removes ports and credentials', () => {
    let d = draftReducer(initialDraft, { type: 'addPort', hostPort: 8080, containerPort: 3000, label: 'web' })
    expect(d.ports).toHaveLength(1)
    d = draftReducer(d, { type: 'removePort', index: 0 })
    expect(d.ports).toHaveLength(0)
    d = draftReducer(d, { type: 'addCredential', label: 'gh', kind: 'git' })
    expect(d.credentials).toEqual([{ label: 'gh', kind: 'git' }])
  })
  it('adds and removes extra folders', () => {
    let d = draftReducer(initialDraft, { type: 'addExtraFolder', path: '/lib', mode: 'clone' })
    expect(d.extraFolders).toEqual([{ path: '/lib', mode: 'clone' }])
    d = draftReducer(d, { type: 'removeExtraFolder', index: 0 })
    expect(d.extraFolders).toEqual([])
  })
})

describe('toSpec', () => {
  it('builds a DefinitionSpec with the workspace as the primary mount', () => {
    const d = {
      ...initialDraft, name: 'alpha', description: 'a', imageChoice: 'claude-code-docker' as const,
      workspace: '/home/u/alpha', workspaceMode: 'direct' as const,
      extraFolders: [{ path: '/home/u/lib', mode: 'clone' as const }],
      tier: 'locked' as const, domains: ['api.github.com'],
      ports: [{ hostPort: 8080, containerPort: 3000, label: 'web' }],
      credentials: [{ label: 'gh', kind: 'git' as const }]
    }
    const spec = toSpec(d, 'id1', '2026-07-18T00:00:00Z')
    expect(spec.definition).toEqual({ id: 'id1', name: 'alpha', description: 'a', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
    expect(spec.mounts).toEqual([
      { hostPath: '/home/u/alpha', mode: 'direct', isPrimary: true },
      { hostPath: '/home/u/lib', mode: 'clone', isPrimary: false }
    ])
    expect(spec.domains).toEqual(['api.github.com'])
    expect(spec.ports).toEqual([{ hostPort: 8080, containerPort: 3000, label: 'web' }])
    expect(spec.credentials).toEqual([{ label: 'gh', kind: 'git' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/renderer/wizard/draft.test.ts --reporter=dot`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reducer**

Create `src/renderer/wizard/draft.ts`:

```ts
import type { Tier, MountMode, CredentialKind, DefinitionSpec } from '@shared/types'

export const TOTAL_STEPS = 7

export type BuiltinVariant = 'claude-code-docker' | 'claude-code' | 'claude-code-minimal'

export interface Draft {
  step: number
  name: string
  description: string
  imageChoice: BuiltinVariant | 'custom'
  customImageRef: string
  workspace: string
  workspaceMode: MountMode
  extraFolders: { path: string; mode: MountMode }[]
  tier: Tier
  domains: string[]
  ports: { hostPort: number; containerPort: number; label: string }[]
  credentials: { label: string; kind: CredentialKind }[]
}

export const initialDraft: Draft = {
  step: 1,
  name: '',
  description: '',
  imageChoice: 'claude-code-docker',
  customImageRef: '',
  workspace: '',
  workspaceMode: 'direct',
  extraFolders: [],
  tier: 'locked',
  domains: [],
  ports: [],
  credentials: []
}

export type DraftAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goToStep'; step: number }
  | { type: 'setField'; field: 'name' | 'description' | 'customImageRef' | 'workspace'; value: string }
  | { type: 'setImageChoice'; value: BuiltinVariant | 'custom' }
  | { type: 'setWorkspaceMode'; mode: MountMode }
  | { type: 'setTier'; tier: Tier }
  | { type: 'addExtraFolder'; path: string; mode: MountMode }
  | { type: 'removeExtraFolder'; index: number }
  | { type: 'addDomain'; host: string }
  | { type: 'removeDomain'; host: string }
  | { type: 'addPort'; hostPort: number; containerPort: number; label: string }
  | { type: 'removePort'; index: number }
  | { type: 'addCredential'; label: string; kind: CredentialKind }
  | { type: 'removeCredential'; index: number }

export function draftReducer(d: Draft, a: DraftAction): Draft {
  switch (a.type) {
    case 'next': return { ...d, step: Math.min(TOTAL_STEPS, d.step + 1) }
    case 'back': return { ...d, step: Math.max(1, d.step - 1) }
    case 'goToStep': return { ...d, step: Math.min(TOTAL_STEPS, Math.max(1, a.step)) }
    case 'setField': return { ...d, [a.field]: a.value }
    case 'setImageChoice': return { ...d, imageChoice: a.value }
    case 'setWorkspaceMode': return { ...d, workspaceMode: a.mode }
    case 'setTier': return { ...d, tier: a.tier }
    case 'addExtraFolder': return { ...d, extraFolders: [...d.extraFolders, { path: a.path, mode: a.mode }] }
    case 'removeExtraFolder': return { ...d, extraFolders: d.extraFolders.filter((_, i) => i !== a.index) }
    case 'addDomain': return d.domains.includes(a.host) ? d : { ...d, domains: [...d.domains, a.host] }
    case 'removeDomain': return { ...d, domains: d.domains.filter((h) => h !== a.host) }
    case 'addPort': return { ...d, ports: [...d.ports, { hostPort: a.hostPort, containerPort: a.containerPort, label: a.label }] }
    case 'removePort': return { ...d, ports: d.ports.filter((_, i) => i !== a.index) }
    case 'addCredential': return { ...d, credentials: [...d.credentials, { label: a.label, kind: a.kind }] }
    case 'removeCredential': return { ...d, credentials: d.credentials.filter((_, i) => i !== a.index) }
    default: return d
  }
}

export function resolveBaseImage(d: Draft): string {
  return d.imageChoice === 'custom' ? d.customImageRef.trim() : `docker/sandbox-templates:${d.imageChoice}`
}

export function parsePort(input: string): { hostPort: number; containerPort: number } | null {
  const m = input.trim().match(/^(\d+):(\d+)$/)
  if (!m) return null
  return { hostPort: Number(m[1]), containerPort: Number(m[2]) }
}

export function canAdvance(d: Draft): boolean {
  if (d.step === 1) return d.name.trim().length > 0
  if (d.step === 2) return resolveBaseImage(d).length > 0
  if (d.step === 3) return d.workspace.trim().length > 0
  return true
}

export function toSpec(d: Draft, id: string, createdAt: string): DefinitionSpec {
  return {
    definition: { id, name: d.name.trim(), description: d.description.trim(), baseImage: resolveBaseImage(d), tier: d.tier, createdAt },
    mounts: [
      { hostPath: d.workspace.trim(), mode: d.workspaceMode, isPrimary: true },
      ...d.extraFolders.map((f) => ({ hostPath: f.path, mode: f.mode, isPrimary: false }))
    ],
    domains: d.domains,
    ports: d.ports,
    credentials: d.credentials
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/renderer/wizard/draft.test.ts --reporter=dot`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(wizard): add pure definition-draft reducer + validation"
```

---

### Task 4: Definitions list screen

**Files:**
- Create: `src/renderer/screens/Definitions.tsx`
- Test: `tests/renderer/Definitions.test.tsx`

**Interfaces:**
- Consumes: `Definition` (shared types).
- Produces:
  - `function Definitions({ definitions, onCreate }: { definitions: Definition[]; onCreate: () => void }): JSX.Element` — presentational. Renders a "Create Definition" button (calls `onCreate`); a table with columns Name / Base image / Network / Created when non-empty; an empty state "No definitions yet" otherwise.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/Definitions.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Definitions } from '../../src/renderer/screens/Definitions'
import type { Definition } from '@shared/types'

const defs: Definition[] = [
  { id: 'd1', name: 'prj-alpha', description: '', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' }
]

describe('Definitions screen', () => {
  it('lists definitions with their base image and tier', () => {
    render(<Definitions definitions={defs} onCreate={() => {}} />)
    expect(screen.getByText('prj-alpha')).toBeInTheDocument()
    expect(screen.getByText('docker/sandbox-templates:claude-code-docker')).toBeInTheDocument()
    expect(screen.getByText('locked')).toBeInTheDocument()
  })

  it('shows the empty state when there are none', () => {
    render(<Definitions definitions={[]} onCreate={() => {}} />)
    expect(screen.getByText(/no definitions yet/i)).toBeInTheDocument()
  })

  it('invokes onCreate when the create button is clicked', () => {
    const onCreate = vi.fn()
    render(<Definitions definitions={[]} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: /create definition/i }))
    expect(onCreate).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/renderer/Definitions.test.tsx --reporter=dot`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the screen**

Create `src/renderer/screens/Definitions.tsx`:

```tsx
import type { Definition } from '@shared/types'

export function Definitions({ definitions, onCreate }: { definitions: Definition[]; onCreate: () => void }): JSX.Element {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Sandbox Definitions</h1>
        <button onClick={onCreate}>Create Definition</button>
      </div>
      {definitions.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No definitions yet. Create one to describe a reusable sandbox environment.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
              <th>Name</th><th>Base image</th><th>Network</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td>{d.name}</td>
                <td>{d.baseImage}</td>
                <td>{d.tier}</td>
                <td>{d.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/renderer/Definitions.test.tsx --reporter=dot`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add Definitions list screen with empty state"
```

---

### Task 5: Wizard component (all 7 steps in one file) + submit

**Files:**
- Create: `src/renderer/wizard/CreateDefinition.tsx`
- Test: `tests/renderer/wizard/CreateDefinition.test.tsx`

**Interfaces:**
- Consumes: `draft.ts` (Task 3), `api.defCreate` (Task 2), `CredentialKind`, `Tier`, `MountMode`.
- Produces:
  - `function CreateDefinition({ onDone, onCancel, createId, now }: { onDone: () => void; onCancel: () => void; createId?: () => string; now?: () => string }): JSX.Element` — the full wizard. `createId`/`now` are injectable for deterministic tests (default to `crypto.randomUUID` / `new Date().toISOString()`). Uses `useReducer(draftReducer, initialDraft)`. Renders a step indicator (`Step N of 7`), the current step's fields, Back/Next buttons (Next disabled when `!canAdvance`), and on step 7 a "Create Definition" button that calls `api.defCreate(toSpec(...))` then `onDone()`.

Rationale for one file: the steps share the single `draft`/`dispatch` and are only meaningful together; splitting into 7 files would scatter one form's state across modules a reviewer must hold at once. Each step is a small local sub-component inside this file.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/wizard/CreateDefinition.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const defCreate = vi.fn()
vi.mock('../../../src/renderer/ipc/client', () => ({ api: { defCreate: (s: unknown) => defCreate(s) } }))

import { CreateDefinition } from '../../../src/renderer/wizard/CreateDefinition'

beforeEach(() => { defCreate.mockReset(); defCreate.mockResolvedValue({ ok: true, data: { id: 'id1' } }) })

function fillNameAndAdvance() {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'prj-alpha' } })
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
}

describe('CreateDefinition wizard', () => {
  it('disables Next on step 1 until a name is entered', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('walks to the review step and submits a spec via defCreate', async () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} createId={() => 'id1'} now={() => '2026-07-18T00:00:00Z'} />)
    // Step 1 -> 2
    fillNameAndAdvance()
    // Step 2 (base image default is valid) -> 3
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Step 3 needs a workspace
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Steps 4,5,6 optional
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 4->5
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 5->6
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 6->7
    // Step 7 review -> create
    fireEvent.click(screen.getByRole('button', { name: /create definition/i }))
    await waitFor(() => expect(defCreate).toHaveBeenCalledOnce())
    const arg = defCreate.mock.calls[0][0]
    expect(arg.definition).toMatchObject({ id: 'id1', name: 'prj-alpha', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked' })
    expect(arg.mounts[0]).toEqual({ hostPath: '/home/u/alpha', mode: 'direct', isPrimary: true })
  })

  it('shows the direct-mode warning on the workspace step', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    fillNameAndAdvance()
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 2->3
    expect(screen.getByText(/git hooks|implicit|makefile/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/renderer/wizard/CreateDefinition.test.tsx --reporter=dot`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the wizard**

Create `src/renderer/wizard/CreateDefinition.tsx`:

```tsx
import { useReducer, useState } from 'react'
import type { CredentialKind, Tier, MountMode } from '@shared/types'
import { api } from '../ipc/client'
import { draftReducer, initialDraft, canAdvance, toSpec, parsePort, resolveBaseImage, TOTAL_STEPS, type BuiltinVariant } from './draft'

const VARIANTS: BuiltinVariant[] = ['claude-code-docker', 'claude-code', 'claude-code-minimal']
const TIERS: Tier[] = ['open', 'balanced', 'locked']
const KINDS: CredentialKind[] = ['git', 'api-key', 'claude-auth']

export function CreateDefinition({
  onDone,
  onCancel,
  createId = () => crypto.randomUUID(),
  now = () => new Date().toISOString()
}: {
  onDone: () => void
  onCancel: () => void
  createId?: () => string
  now?: () => string
}): JSX.Element {
  const [draft, dispatch] = useReducer(draftReducer, initialDraft)
  const [domainInput, setDomainInput] = useState('')
  const [portInput, setPortInput] = useState('')
  const [portLabel, setPortLabel] = useState('')
  const [folderInput, setFolderInput] = useState('')
  const [credLabel, setCredLabel] = useState('')
  const [credKind, setCredKind] = useState<CredentialKind>('git')
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    const res = await api.defCreate(toSpec(draft, createId(), now()))
    if (res.ok) onDone()
    else setError(res.error.message)
  }

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>Create Definition</h1>
        <button onClick={onCancel}>Cancel</button>
      </div>
      <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>Step {draft.step} of {TOTAL_STEPS}</p>

      {draft.step === 1 && (
        <div>
          <label>Name<br /><input aria-label="Name" value={draft.name} onChange={(e) => dispatch({ type: 'setField', field: 'name', value: e.target.value })} /></label>
          <br /><label>Description<br /><textarea aria-label="Description" value={draft.description} onChange={(e) => dispatch({ type: 'setField', field: 'description', value: e.target.value })} /></label>
        </div>
      )}

      {draft.step === 2 && (
        <div>
          <p>Base image</p>
          {VARIANTS.map((v) => (
            <label key={v} style={{ display: 'block' }}>
              <input type="radio" name="image" checked={draft.imageChoice === v} onChange={() => dispatch({ type: 'setImageChoice', value: v })} /> {v}
            </label>
          ))}
          <label style={{ display: 'block' }}>
            <input type="radio" name="image" checked={draft.imageChoice === 'custom'} onChange={() => dispatch({ type: 'setImageChoice', value: 'custom' })} /> Custom template
          </label>
          {draft.imageChoice === 'custom' && (
            <input aria-label="Custom image ref" placeholder="docker.io/org/img:tag" value={draft.customImageRef} onChange={(e) => dispatch({ type: 'setField', field: 'customImageRef', value: e.target.value })} />
          )}
          <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Resolves to: {resolveBaseImage(draft) || '—'}</p>
        </div>
      )}

      {draft.step === 3 && (
        <div>
          <label>Workspace directory<br /><input aria-label="Workspace" value={draft.workspace} onChange={(e) => dispatch({ type: 'setField', field: 'workspace', value: e.target.value })} /></label>
          <div>
            <label><input type="radio" name="wsmode" checked={draft.workspaceMode === 'direct'} onChange={() => dispatch({ type: 'setWorkspaceMode', mode: 'direct' })} /> Read-write (direct)</label>
            <label><input type="radio" name="wsmode" checked={draft.workspaceMode === 'clone'} onChange={() => dispatch({ type: 'setWorkspaceMode', mode: 'clone' })} /> Read-only (clone)</label>
          </div>
          {draft.workspaceMode === 'direct' && (
            <p style={{ color: 'var(--danger)', fontSize: 12 }}>Direct mode exposes files with implicit execution (git hooks, CI config, Makefiles) to edits not visible in a normal diff.</p>
          )}
          <div>
            <p>Extra folders</p>
            <input aria-label="Extra folder path" value={folderInput} onChange={(e) => setFolderInput(e.target.value)} />
            <button onClick={() => { if (folderInput.trim()) { dispatch({ type: 'addExtraFolder', path: folderInput.trim(), mode: 'clone' }); setFolderInput('') } }}>Add folder</button>
            <ul>{draft.extraFolders.map((f, i) => (<li key={i}>{f.path} ({f.mode}) <button onClick={() => dispatch({ type: 'removeExtraFolder', index: i })}>remove</button></li>))}</ul>
          </div>
        </div>
      )}

      {draft.step === 4 && (
        <div>
          <p>Network policy tier</p>
          {TIERS.map((t) => (
            <label key={t} style={{ display: 'block' }}>
              <input type="radio" name="tier" checked={draft.tier === t} onChange={() => dispatch({ type: 'setTier', tier: t })} /> {t}
            </label>
          ))}
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>Allowlist (HTTP/HTTPS domains only)</p>
          <input aria-label="Domain" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} />
          <button onClick={() => { if (domainInput.trim()) { dispatch({ type: 'addDomain', host: domainInput.trim() }); setDomainInput('') } }}>Add domain</button>
          <ul>{draft.domains.map((h) => (<li key={h}>{h} <button onClick={() => dispatch({ type: 'removeDomain', host: h })}>remove</button></li>))}</ul>
        </div>
      )}

      {draft.step === 5 && (
        <div>
          <p>Published ports (forwarded after launch, bound to 127.0.0.1)</p>
          <input aria-label="Port mapping" placeholder="8080:3000" value={portInput} onChange={(e) => setPortInput(e.target.value)} />
          <input aria-label="Port label" placeholder="label" value={portLabel} onChange={(e) => setPortLabel(e.target.value)} />
          <button onClick={() => { const p = parsePort(portInput); if (p) { dispatch({ type: 'addPort', hostPort: p.hostPort, containerPort: p.containerPort, label: portLabel.trim() }); setPortInput(''); setPortLabel('') } }}>Add port</button>
          <ul>{draft.ports.map((p, i) => (<li key={i}>{p.hostPort}:{p.containerPort} {p.label} <button onClick={() => dispatch({ type: 'removePort', index: i })}>remove</button></li>))}</ul>
        </div>
      )}

      {draft.step === 6 && (
        <div>
          <p>Credentials (declarations only — values are set at launch)</p>
          <input aria-label="Credential label" value={credLabel} onChange={(e) => setCredLabel(e.target.value)} />
          <select aria-label="Credential kind" value={credKind} onChange={(e) => setCredKind(e.target.value as CredentialKind)}>
            {KINDS.map((k) => (<option key={k} value={k}>{k}</option>))}
          </select>
          <button onClick={() => { if (credLabel.trim()) { dispatch({ type: 'addCredential', label: credLabel.trim(), kind: credKind }); setCredLabel('') } }}>Add credential</button>
          <ul>{draft.credentials.map((c, i) => (<li key={i}>{c.label} ({c.kind}) <button onClick={() => dispatch({ type: 'removeCredential', index: i })}>remove</button></li>))}</ul>
        </div>
      )}

      {draft.step === 7 && (
        <div>
          <h2>Review</h2>
          <ul style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            <li>Name: {draft.name}</li>
            <li>Base image: {resolveBaseImage(draft)}</li>
            <li>Workspace: {draft.workspace} ({draft.workspaceMode})</li>
            <li>Extra folders: {draft.extraFolders.length}</li>
            <li>Tier: {draft.tier} · {draft.domains.length} domains</li>
            <li>Ports: {draft.ports.length}</li>
            <li>Credentials: {draft.credentials.length}</li>
          </ul>
          {error && <p style={{ color: 'var(--danger)' }}>Error: {error}</p>}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={() => dispatch({ type: 'back' })} disabled={draft.step === 1}>Back</button>
        {draft.step < TOTAL_STEPS ? (
          <button onClick={() => dispatch({ type: 'next' })} disabled={!canAdvance(draft)}>Next</button>
        ) : (
          <button onClick={() => void submit()}>Create Definition</button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/renderer/wizard/CreateDefinition.test.tsx --reporter=dot`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(wizard): add 7-step Create Definition wizard with submit"
```

---

### Task 6: Nav shell + App routing (Definitions ⇄ wizard ⇄ Instances)

**Files:**
- Create: `src/renderer/components/NavShell.tsx`
- Modify: `src/renderer/App.tsx`
- Test: `tests/renderer/App.nav.test.tsx`

**Interfaces:**
- Consumes: `Definitions` (Task 4), `CreateDefinition` (Task 5), `Instances` (Phase 1), `Prereq` (Phase 1), `api.defList`/`api.instancesList`/`api.prereqCheck`.
- Produces:
  - `function NavShell({ active, onNavigate, children }: { active: 'definitions' | 'instances'; onNavigate: (s: 'definitions' | 'instances') => void; children: React.ReactNode }): JSX.Element` — sidebar with two nav buttons and a content area.
  - Updated `App` state machine: after the prereq gate passes, default to the `definitions` screen; nav switches between Definitions and Instances (each loads its data on entry); the "Create Definition" button swaps the content region to the wizard; the wizard's `onDone`/`onCancel` return to the Definitions list and reload it.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/App.nav.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const prereqCheck = vi.fn()
const instancesList = vi.fn()
const defList = vi.fn()
vi.mock('../../src/renderer/ipc/client', () => ({
  api: {
    prereqCheck: () => prereqCheck(),
    instancesList: () => instancesList(),
    defList: () => defList(),
    defCreate: async () => ({ ok: true, data: { id: 'id1' } })
  }
}))

import App from '../../src/renderer/App'

beforeEach(() => {
  prereqCheck.mockReset(); instancesList.mockReset(); defList.mockReset()
  prereqCheck.mockResolvedValue({ ok: true, data: { ok: true, checks: [] } })
  instancesList.mockResolvedValue({ ok: true, data: [] })
  defList.mockResolvedValue({ ok: true, data: [] })
})

describe('App navigation', () => {
  it('lands on Definitions after the prereq gate passes', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Sandbox Definitions')).toBeInTheDocument())
  })

  it('navigates to Instances', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Sandbox Definitions')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /instances/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Instances' })).toBeInTheDocument())
  })

  it('opens the wizard from the create button and returns on cancel', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Sandbox Definitions')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /create definition/i }))
    await waitFor(() => expect(screen.getByText('Create Definition')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.getByText('Sandbox Definitions')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/renderer/App.nav.test.tsx --reporter=dot`
Expected: FAIL — `Sandbox Definitions` not rendered (App still shows Instances directly).

- [ ] **Step 3: Implement NavShell**

Create `src/renderer/components/NavShell.tsx`:

```tsx
import type { ReactNode } from 'react'

type Screen = 'definitions' | 'instances'

export function NavShell({ active, onNavigate, children }: { active: Screen; onNavigate: (s: Screen) => void; children: ReactNode }): JSX.Element {
  const item = (id: Screen, label: string): JSX.Element => (
    <button
      onClick={() => onNavigate(id)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: 'var(--space-3)',
        background: active === id ? 'var(--surface)' : 'transparent',
        color: active === id ? 'var(--accent)' : 'var(--fg)', border: 'none', cursor: 'pointer'
      }}
    >{label}</button>
  )
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 200, borderRight: '1px solid var(--border)', padding: 'var(--space-3)' }}>
        {item('definitions', 'Definitions')}
        {item('instances', 'Instances')}
      </nav>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  )
}
```

- [ ] **Step 4: Rewrite App routing**

Replace `src/renderer/App.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react'
import type { PrereqResult, InstanceView, Definition } from '@shared/types'
import { api } from './ipc/client'
import { Prereq } from './screens/Prereq'
import { Instances } from './screens/Instances'
import { Definitions } from './screens/Definitions'
import { CreateDefinition } from './wizard/CreateDefinition'
import { NavShell } from './components/NavShell'

type Gate = { kind: 'loading' } | { kind: 'prereq'; result: PrereqResult } | { kind: 'ready' } | { kind: 'error'; message: string }
type Screen = 'definitions' | 'instances'

export default function App(): JSX.Element {
  const [gate, setGate] = useState<Gate>({ kind: 'loading' })
  const [screen, setScreen] = useState<Screen>('definitions')
  const [wizard, setWizard] = useState(false)
  const [defs, setDefs] = useState<Definition[]>([])
  const [instances, setInstances] = useState<InstanceView[]>([])

  const loadDefs = useCallback(async () => {
    const r = await api.defList()
    if (r.ok) setDefs(r.data)
  }, [])
  const loadInstances = useCallback(async () => {
    const r = await api.instancesList()
    if (r.ok) setInstances(r.data)
  }, [])

  const runGate = useCallback(async () => {
    setGate({ kind: 'loading' })
    const pre = await api.prereqCheck()
    if (!pre.ok) return setGate({ kind: 'error', message: pre.error.message })
    if (!pre.data.ok) return setGate({ kind: 'prereq', result: pre.data })
    setGate({ kind: 'ready' })
    await loadDefs()
  }, [loadDefs])

  useEffect(() => { void runGate() }, [runGate])

  function navigate(s: Screen): void {
    setWizard(false)
    setScreen(s)
    if (s === 'definitions') void loadDefs()
    else void loadInstances()
  }

  if (gate.kind === 'loading') return <p style={{ padding: 16 }}>Loading…</p>
  if (gate.kind === 'error') return <p style={{ padding: 16, color: 'var(--danger)' }}>Error: {gate.message}</p>
  if (gate.kind === 'prereq') return <Prereq result={gate.result} onRecheck={() => void runGate()} />

  return (
    <NavShell active={screen} onNavigate={navigate}>
      {wizard ? (
        <CreateDefinition
          onDone={() => { setWizard(false); void loadDefs() }}
          onCancel={() => setWizard(false)}
        />
      ) : screen === 'definitions' ? (
        <Definitions definitions={defs} onCreate={() => setWizard(true)} />
      ) : (
        <Instances instances={instances} />
      )}
    </NavShell>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/renderer/App.nav.test.tsx --reporter=dot`
Expected: PASS (3 tests).

Note: the Phase 1 `tests/renderer/App.test.tsx` asserted the old direct-to-Instances behavior. Update its second test to reflect the new default screen: after prereqs pass the app now lands on **Definitions**. Change the `'shows Instances when prerequisites pass'` test to add `defList` to the mock and assert `screen.getByText('Sandbox Definitions')` instead of `'Instances'`, then click the Instances nav button to reach the Instances screen. Apply:

Replace the `vi.mock` and the second test in `tests/renderer/App.test.tsx`:

```tsx
const prereqCheck = vi.fn()
const instancesList = vi.fn()
const defList = vi.fn()
vi.mock('../../src/renderer/ipc/client', () => ({ api: {
  prereqCheck: () => prereqCheck(), instancesList: () => instancesList(), defList: () => defList(),
  defCreate: async () => ({ ok: true, data: { id: 'id1' } })
} }))
```

and the passing-prereq test body:

```tsx
  it('shows Definitions when prerequisites pass', async () => {
    prereqCheck.mockResolvedValue({ ok: true, data: { ok: true, checks: [] } })
    defList.mockResolvedValue({ ok: true, data: [] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Sandbox Definitions')).toBeInTheDocument())
  })
```

Add `const defList = vi.fn()` and `beforeEach(() => { ...; defList.mockReset() })` alongside the existing resets.

- [ ] **Step 6: Full sweep + typecheck + build**

Run: `rtk proxy npx vitest run --reporter=dot`
Expected: all suites PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `rtk proxy npx electron-vite build`
Expected: all three bundles build.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): add nav shell and wire Definitions + wizard + Instances routing"
```

---

## Self-Review

**1. Spec coverage (design doc §Flow 01 "Create definition" + Definitions/Create screens → tasks):**
- Reusable definition persisted to SQLite, no `sbx` call → Tasks 1, 2. ✓
- Base image selection (built-in `claude-code*` variants + custom ref, default `claude-code-docker`), applied via the resolved template string → Task 3 (`resolveBaseImage`), Task 5 (Step 2). ✓
- Workspace + extra folders with direct/clone modes; direct-mode implicit-execution warning → Task 3 (`toSpec` mounts), Task 5 (Step 3). ✓
- Network tier (default Locked Down) + editable allowlist → Task 3, Task 5 (Step 4). ✓
- Published-port **intents** (not forwarded) → Task 1 (`port_intent`), Task 5 (Step 5). ✓
- Credential **declarations** only, no values in SQLite → Task 1 (`credential_ref`, no value column), Task 5 (Step 6), Global Constraints. ✓
- Definitions list screen + empty state + create entry point → Task 4, Task 6. ✓
- 7-step wizard with review/submit → Task 5. ✓
- **Deferred (correctly out of scope):** launching an instance from a definition (Phase 3), credential value capture/keychain (Phase 6), live policy/ports editors (Phase 5), tier→default-allowlist wildcard mapping (design open question), Settings/Detail screens (later).

**2. Placeholder scan:** No TBD/TODO. Every code step is complete; every test step has real assertions and an explicit expected result.

**3. Type consistency:** `DefinitionSpec`, `MountIntent`, `PortIntent`, `CredentialRef`, `MountMode`, `CredentialKind` defined once in Task 1 (`src/shared/types.ts`) and consumed unchanged in Tasks 2, 3, 5. `Draft`/`draftReducer`/`toSpec`/`resolveBaseImage`/`parsePort`/`canAdvance`/`TOTAL_STEPS` defined in Task 3 and consumed in Task 5. `Store.insertDefinitionSpec`/`getDefinitionSpec` defined in Task 1 and consumed in Task 2. `api.defCreate`/`defList` defined in Task 2 and consumed in Tasks 5, 6. `NavShell`'s `Screen` union (`'definitions'|'instances'`) matches App's. The Phase 1 `App.test.tsx` behavioral change is explicitly reconciled in Task 6 Step 5.

**4. Ambiguity:** Tier→allowlist auto-seed is intentionally omitted (the wizard starts with an empty, user-edited allowlist) to avoid inventing `sbx`'s wildcard defaults before they're confirmed — matches the design doc's open question. Port input format is fixed to `host:container` via `parsePort`, validated.

---

## Notes for later phases

- `getDefinitionSpec` (Task 1) is the read path Phase 3 will consume to launch an instance from a stored definition.
- `credential_ref` rows carry only a label + kind; Phase 6 adds the value-capture path (`sbx secret set` + keychain/AES) keyed off these declarations.
- The nav shell has two entries now; Settings and the instance Detail view slot in as additional `Screen` values in later phases.
- The dual native-ABI note from Phase 1 still applies: tests run on the Node-ABI `better-sqlite3`; `npm run dev` needs the Electron-ABI rebuild.
