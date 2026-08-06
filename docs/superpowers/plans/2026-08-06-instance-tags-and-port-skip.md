# Instance Tags + Smart Port-Forward Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users assign free-form tags to sandbox instances (at launch and later), fold those tags into the generated instance name, filter instances by tag, and automatically skip fixed-host-port forwards on the 2nd+ instance of a definition to avoid port collisions.

**Architecture:** Tags are app-side metadata stored in a new `instance_tag` SQLite table keyed by `sbx_name` (separate from `instance_meta` so the reconciler's adopt/GC upserts never clobber them). `reconcile()` attaches `tags: string[]` to each `InstanceView`. The launch path composes the name from the definition slug + slugified tags + hash, counts prior instances of the definition to decide whether to drop fixed-host-port forwards, and persists the normalized tags. The renderer gains a reusable `TagInput` chip control used by the Launch dialog and Instance Detail, plus a tag-filter bar on the Instances screen.

**Tech Stack:** Electron 3-process (main/preload/renderer), TypeScript, React 18, `better-sqlite3`, Vitest (+ jsdom for renderer), `@testing-library/react`. Path aliases: `@shared`, `@main`.

## Global Constraints

- Run `npm run typecheck` and `npm test` before claiming any task complete.
- Secrets never cross the IPC boundary or touch a command line — tags are non-secret, but keep the existing `Result<T>` wrapping on every IPC handler (failures never throw across IPC).
- Follow existing patterns: IPC handlers return `Result<T>` via `wrap()`; preload exposes one flat method per channel; renderer imports `api` from `ipc/client`, never `ipcRenderer`.
- SQLite migrations are forward-only, gated on `PRAGMA table_info`/`CREATE TABLE IF NOT EXISTS`, versioned via `PRAGMA user_version`. Never drop tables that could hold real data.
- Tag normalization limits (single source of truth in `src/shared/tags.ts`): **max 10 tags per instance, max 32 chars per tag**, trimmed, empty dropped, deduped case-insensitively (first casing wins, original casing preserved for display).
- Name-composition budget: base name (definition slug + tags, before the `-<hash>` suffix) capped at **40 chars**; tags are appended in entry order and appending stops at the first tag that would exceed the budget. Definition slug and hash are never dropped.
- Add every new user-facing string to BOTH `src/renderer/i18n/en.ts` and `src/renderer/i18n/de.ts` (German may reuse English copy if no translation is provided, but the key MUST exist in both).

---

## File Structure

**Create:**
- `src/shared/tags.ts` — `normalizeTags`, `MAX_TAGS`, `MAX_TAG_LEN` (pure, shared by main + renderer).
- `src/renderer/components/TagInput.tsx` — reusable tag chip input.
- `tests/shared/tags.test.ts`, `tests/shared/names.test.ts` (if absent — else append), `tests/main/store/instance-tags.test.ts`, `tests/main/launch.test.ts`, `tests/renderer/TagInput.test.tsx`.

**Modify:**
- `src/shared/names.ts` — add `composeInstanceBaseName`.
- `src/shared/types.ts` — add `tags: string[]` to `InstanceView`.
- `src/main/store/db.ts` — `instance_tag` table, `setInstanceTags`/`listInstanceTags`, tag cleanup in `deleteInstanceMeta`.
- `src/main/sbx/translate.ts` — `portsForLaunch` helper + `launchCommand` ports override.
- `src/main/launch.ts` — normalize tags, compose name, skip fixed ports on subsequent launch, persist tags.
- `src/main/reconciler.ts` — attach tags to each `InstanceView`.
- `src/main/ipc.ts` — thread `tags` through `instance:launch`, add `instance:setTags`, carry tags across `instance:rebuild`.
- `src/preload/index.ts` — `instanceLaunch` gains `tags`, add `instanceSetTags`.
- `src/renderer/ipc/client.ts` — update `Api` type + fallback stub.
- `src/renderer/components/LaunchDialog.tsx` — tags input + skip note.
- `src/renderer/screens/Instances.tsx` — tag chips column + filter bar.
- `src/renderer/screens/InstanceDetail.tsx` — tags editor.
- `src/renderer/App.tsx` — thread tags + skip-note data + `onSetTags`.
- `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts` — new keys.
- `tests/renderer/Instances.test.tsx`, `tests/renderer/App.test.tsx` (extend as needed).

---

## Task 1: Shared tag normalization + name composition (pure)

**Files:**
- Create: `src/shared/tags.ts`
- Modify: `src/shared/names.ts`
- Test: `tests/shared/tags.test.ts`, `tests/shared/names.test.ts`

**Interfaces:**
- Produces:
  - `normalizeTags(raw: string[]): string[]`
  - `MAX_TAGS: number` (= 10), `MAX_TAG_LEN: number` (= 32)
  - `composeInstanceBaseName(definitionName: string, tags: string[], maxLen?: number): string`

- [ ] **Step 1: Write the failing test for `normalizeTags`**

Create `tests/shared/tags.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeTags, MAX_TAGS } from '../../src/shared/tags'

describe('normalizeTags', () => {
  it('trims and drops empty/whitespace tags', () => {
    expect(normalizeTags([' prod ', '', '   ', 'eu'])).toEqual(['prod', 'eu'])
  })
  it('dedupes case-insensitively, keeping first casing', () => {
    expect(normalizeTags(['Prod', 'prod', 'PROD'])).toEqual(['Prod'])
  })
  it('truncates each tag to 32 chars', () => {
    const long = 'x'.repeat(40)
    expect(normalizeTags([long])).toEqual(['x'.repeat(32)])
  })
  it('caps the number of tags at MAX_TAGS', () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `t${i}`)
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/tags.test.ts`
Expected: FAIL — cannot find module `src/shared/tags`.

- [ ] **Step 3: Implement `src/shared/tags.ts`**

```ts
export const MAX_TAGS = 10
export const MAX_TAG_LEN = 32

/**
 * Normalise a raw tag list for storage/display: trim, drop empties, truncate each
 * to MAX_TAG_LEN, dedupe case-insensitively (first occurrence's casing wins), and
 * cap the count at MAX_TAGS. Total (never rejects) — malformed input is cleaned.
 */
export function normalizeTags(raw: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    const t = r.trim().slice(0, MAX_TAG_LEN)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= MAX_TAGS) break
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `composeInstanceBaseName`**

Create (or append to) `tests/shared/names.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { composeInstanceBaseName } from '../../src/shared/names'

describe('composeInstanceBaseName', () => {
  it('slugifies the definition name when there are no tags', () => {
    expect(composeInstanceBaseName('My Proj', [])).toBe('myproj')
  })
  it('appends slugified tags in entry order', () => {
    expect(composeInstanceBaseName('My Proj', ['prod', 'eu'])).toBe('myproj-prod-eu')
  })
  it('slugifies tags (lowercase, non-alphanumerics to hyphens)', () => {
    expect(composeInstanceBaseName('proj', ['EU West'])).toBe('proj-eu-west')
  })
  it('stops appending at the first tag that would exceed the length budget', () => {
    // budget 12: "proj" (4) + "-aaaa" (5) = 9 ok; next "-bbbbb" (6) => 15 > 12 => stop
    expect(composeInstanceBaseName('proj', ['aaaa', 'bbbbb', 'c'], 12)).toBe('proj-aaaa')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/shared/names.test.ts`
Expected: FAIL — `composeInstanceBaseName` is not exported.

- [ ] **Step 7: Implement `composeInstanceBaseName` in `src/shared/names.ts`**

Append below the existing `toSbxName`:

```ts
/**
 * Compose the base sandbox name from a definition name plus tags:
 * `<definition-slug>-<tag1>-<tag2>-…`. Each tag is slugified with toSbxName rules.
 * Tags are appended in entry order only while the result stays within `maxLen`
 * (appending stops at the first tag that would overflow); the definition slug is
 * always kept. A launch hash is added separately by hashedSandboxName().
 */
export function composeInstanceBaseName(definitionName: string, tags: string[], maxLen = 40): string {
  let base = toSbxName(definitionName)
  for (const tag of tags) {
    const slug = toSbxName(tag)
    if (slug === 'sandbox' && tag.trim() === '') continue
    if (!slug) continue
    const next = `${base}-${slug}`
    if (next.length > maxLen) break
    base = next
  }
  return base
}
```

Note: `toSbxName` returns `'sandbox'` for an all-non-alphanumeric input; in practice `normalizeTags` runs first so such tags won't reach here, but the guard keeps the slug meaningful.

- [ ] **Step 8: Run both shared tests**

Run: `npx vitest run tests/shared/tags.test.ts tests/shared/names.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/shared/tags.ts src/shared/names.ts tests/shared/tags.test.ts tests/shared/names.test.ts
git commit -m "feat(tags): shared tag normalization + instance name composition"
```

---

## Task 2: Store — `instance_tag` table + methods + cascade cleanup

**Files:**
- Modify: `src/main/store/db.ts` (Store interface ~5-23, SCHEMA ~25-108, migration block ~110-162, `deleteInstanceMeta` ~285-287, returned object)
- Test: `tests/main/store/instance-tags.test.ts`

**Interfaces:**
- Produces (new `Store` methods):
  - `setInstanceTags(sbxName: string, tags: string[]): void` — replaces the full tag set for one instance.
  - `listInstanceTags(): Map<string, string[]>` — all tags grouped by `sbx_name`, in insertion order.
- Behavior change: `deleteInstanceMeta(sbxName)` also deletes that name's tags.

- [ ] **Step 1: Write the failing test**

Create `tests/main/store/instance-tags.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '@main/store/db'

let store: Store
beforeEach(() => { store = openStore(':memory:') })

function seedInstance(name: string): void {
  store.upsertInstanceMeta({ sbxName: name, definitionId: null, createdByApp: true, createdAt: new Date().toISOString(), credFingerprint: null })
}

describe('instance tags', () => {
  it('returns an empty map when nothing is tagged', () => {
    expect(store.listInstanceTags().size).toBe(0)
  })
  it('stores and reads back tags for an instance in order', () => {
    seedInstance('proj-a1')
    store.setInstanceTags('proj-a1', ['prod', 'eu'])
    expect(store.listInstanceTags().get('proj-a1')).toEqual(['prod', 'eu'])
  })
  it('replaces the full tag set on a second write', () => {
    seedInstance('proj-a1')
    store.setInstanceTags('proj-a1', ['prod', 'eu'])
    store.setInstanceTags('proj-a1', ['staging'])
    expect(store.listInstanceTags().get('proj-a1')).toEqual(['staging'])
  })
  it('drops tags when the instance meta is deleted', () => {
    seedInstance('proj-a1')
    store.setInstanceTags('proj-a1', ['prod'])
    store.deleteInstanceMeta('proj-a1')
    expect(store.listInstanceTags().has('proj-a1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/store/instance-tags.test.ts`
Expected: FAIL — `store.setInstanceTags is not a function`.

- [ ] **Step 3: Add the table to SCHEMA and bump the version**

In `src/main/store/db.ts`, inside the `SCHEMA` template (after the `global_secret` table, before `PRAGMA user_version`), add:

```sql
CREATE TABLE IF NOT EXISTS instance_tag (
  sbx_name TEXT NOT NULL,
  tag      TEXT NOT NULL,
  PRIMARY KEY (sbx_name, tag)
);
```

Change the trailing pragma from `PRAGMA user_version = 10;` to `PRAGMA user_version = 11;`. (The `CREATE TABLE IF NOT EXISTS` in `db.exec(SCHEMA)` runs on every open, so no separate ALTER is needed — existing databases gain the table on next launch.)

- [ ] **Step 4: Add the interface signatures**

In the `Store` interface (top of file), add after `updateInstanceFingerprint`:

```ts
  setInstanceTags(sbxName: string, tags: string[]): void
  listInstanceTags(): Map<string, string[]>
```

- [ ] **Step 5: Implement the methods and cascade**

In the returned object, replace the existing `deleteInstanceMeta` with a tag-aware version and add the two new methods next to it:

```ts
    deleteInstanceMeta(sbxName) {
      db.prepare(`DELETE FROM instance_tag WHERE sbx_name = ?`).run(sbxName)
      db.prepare(`DELETE FROM instance_meta WHERE sbx_name = ?`).run(sbxName)
    },
    setInstanceTags(sbxName, tags) {
      const tx = db.transaction((name: string, ts: string[]) => {
        db.prepare(`DELETE FROM instance_tag WHERE sbx_name = ?`).run(name)
        const ins = db.prepare(`INSERT OR IGNORE INTO instance_tag (sbx_name, tag) VALUES (?, ?)`)
        for (const tag of ts) ins.run(name, tag)
      })
      tx(sbxName, tags)
    },
    listInstanceTags() {
      const rows = db.prepare(`SELECT sbx_name AS sbxName, tag FROM instance_tag ORDER BY rowid`).all() as Array<{ sbxName: string; tag: string }>
      const map = new Map<string, string[]>()
      for (const r of rows) {
        const arr = map.get(r.sbxName) ?? []
        arr.push(r.tag)
        map.set(r.sbxName, arr)
      }
      return map
    },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/main/store/instance-tags.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + full store tests**

Run: `npm run typecheck && npx vitest run tests/main/store`
Expected: PASS (no regressions in `db-prefs`).

- [ ] **Step 8: Commit**

```bash
git add src/main/store/db.ts tests/main/store/instance-tags.test.ts
git commit -m "feat(store): instance_tag table with set/list + cascade delete"
```

---

## Task 3: Reconciler attaches `tags` to `InstanceView`

**Files:**
- Modify: `src/shared/types.ts` (`InstanceView` ~176-182)
- Modify: `src/main/reconciler.ts` (`reconcile` ~57-121)
- Test: `tests/main/reconcile-tags.test.ts`

**Interfaces:**
- Consumes: `store.listInstanceTags()` (Task 2).
- Produces: `InstanceView.tags: string[]` — always present (empty array when untagged).

- [ ] **Step 1: Add `tags` to the `InstanceView` type**

In `src/shared/types.ts`, extend `InstanceView`:

```ts
export interface InstanceView extends SbxInstance {
  definitionId: string | null
  definitionName: string | null
  tier: Tier | 'custom'
  /** The definition's credentials changed since this instance was created — rebuild to apply. */
  credsDrift?: boolean
  /** App-side tags assigned to this instance (empty when untagged). */
  tags: string[]
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/reconcile-tags.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reconcile } from '@main/reconciler'
import { openStore } from '@main/store/db'
import type { SbxInstance } from '@shared/types'

function fakeAdapter(instances: SbxInstance[]) {
  return { listSandboxes: async () => instances } as never
}

describe('reconcile attaches tags', () => {
  it('populates InstanceView.tags from the store', async () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'proj-a1', definitionId: null, createdByApp: true, createdAt: new Date().toISOString(), credFingerprint: null })
    store.setInstanceTags('proj-a1', ['prod', 'eu'])
    const views = await reconcile(fakeAdapter([{ name: 'proj-a1', status: 'running', agent: 'claude', workspace: null, ports: [] }]), store)
    expect(views[0].tags).toEqual(['prod', 'eu'])
  })
  it('defaults to an empty array for untagged instances', async () => {
    const store = openStore(':memory:')
    const views = await reconcile(fakeAdapter([{ name: 'x-1', status: 'running', agent: 'claude', workspace: null, ports: [] }]), store)
    expect(views[0].tags).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/main/reconcile-tags.test.ts`
Expected: FAIL — `tags` is `undefined`.

- [ ] **Step 4: Populate `tags` in `reconcile`**

In `src/main/reconciler.ts`, inside `reconcile`, build the tag map once after `metaByName` is created:

```ts
  const tagsByName = store.listInstanceTags()
```

Then in the returned object of the `instances.map((inst) => {…})` block, add `tags`:

```ts
    return {
      ...inst,
      definitionId: def?.id ?? null,
      definitionName: def?.name ?? null,
      tier: def?.tier ?? 'custom',
      credsDrift,
      tags: tagsByName.get(inst.name) ?? []
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/main/reconcile-tags.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck (this surfaces every `InstanceView` construction site)**

Run: `npm run typecheck`
Expected: PASS. If any test helper builds an `InstanceView` literal and now errors on the missing `tags`, add `tags: []` to it. Renderer components read `instance.tags` in later tasks; they don't construct `InstanceView`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/reconciler.ts tests/main/reconcile-tags.test.ts
git commit -m "feat(reconciler): attach tags to InstanceView"
```

---

## Task 4: `launchCommand` port-skip helper + ports override

**Files:**
- Modify: `src/main/sbx/translate.ts` (`launchCommand` ~150-187)
- Test: `tests/main/sbx/translate-port-skip.test.ts`

**Interfaces:**
- Produces:
  - `portsForLaunch(ports: PortIntent[], isSubsequent: boolean): PortIntent[]` — returns all ports on a first launch; only ephemeral (`hostPort === null`) ports on a subsequent one.
  - `launchCommand(spec, name?, sessionName?, kitDir?, ports?: PortIntent[])` — publishes exactly the ports passed (defaulting to `spec.ports`).

- [ ] **Step 1: Write the failing test**

Create `tests/main/sbx/translate-port-skip.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { portsForLaunch, launchCommand } from '../../../src/main/sbx/translate'
import type { DefinitionSpec, PortIntent } from '@shared/types'

const ports: PortIntent[] = [
  { hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: '' }, // fixed
  { hostPort: null, containerPort: 9229, protocol: 'tcp', label: '' }  // ephemeral
]

describe('portsForLaunch', () => {
  it('keeps every port on a first launch', () => {
    expect(portsForLaunch(ports, false)).toEqual(ports)
  })
  it('keeps only ephemeral ports on a subsequent launch', () => {
    expect(portsForLaunch(ports, true)).toEqual([ports[1]])
  })
})

function spec(): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: '' },
    mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
    domains: [], ports, hostServices: [], credentials: []
  }
}

describe('launchCommand ports override', () => {
  it('publishes only the ports it is given', () => {
    const cmd = launchCommand(spec(), 'proj-a1', undefined, undefined, portsForLaunch(ports, true))
    expect(cmd).toContain('--publish 9229/tcp')
    expect(cmd).not.toContain('8080:3000')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/sbx/translate-port-skip.test.ts`
Expected: FAIL — `portsForLaunch` is not exported.

- [ ] **Step 3: Add `portsForLaunch` and the `ports` param**

In `src/main/sbx/translate.ts`, add near `portIntentToPublishSpec`:

```ts
/**
 * The ports to publish for a launch. First instance of a definition → all ports.
 * A subsequent instance → only ephemeral (OS-allocated) ports, since fixed host
 * ports would collide with the sibling that already claimed them. Corrected fixed
 * ports are added later from the instance's Ports tab.
 */
export function portsForLaunch(ports: PortIntent[], isSubsequent: boolean): PortIntent[] {
  return isSubsequent ? ports.filter((p) => p.hostPort === null) : ports
}
```

Change the `launchCommand` signature to accept the port list (defaulting to `spec.ports`) and use it in the publish loop:

```ts
export function launchCommand(spec: DefinitionSpec, name: string = resolveSandboxName(spec), sessionName?: string, kitDir?: string, ports: PortIntent[] = spec.ports): string {
```

Then change the existing loop `for (const p of spec.ports) {` to `for (const p of ports) {`. Leave the rest of the function unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/sbx/translate-port-skip.test.ts`
Expected: PASS.

- [ ] **Step 5: Guard against regressions in existing translate tests**

Run: `npx vitest run tests/main/sbx`
Expected: PASS (existing `translate-ports`, `adapter-ports`, `translate-login` unaffected — the default param preserves old behavior).

- [ ] **Step 6: Commit**

```bash
git add src/main/sbx/translate.ts tests/main/sbx/translate-port-skip.test.ts
git commit -m "feat(launch): portsForLaunch skip helper + launchCommand ports override"
```

---

## Task 5: `launchDefinition` — tags into name, skip on subsequent, persist tags

**Files:**
- Modify: `src/main/launch.ts` (`launchDefinition` ~39-102)
- Test: `tests/main/launch.test.ts`

**Interfaces:**
- Consumes: `composeInstanceBaseName` (Task 1), `normalizeTags` (Task 1), `portsForLaunch` (Task 4), `store.setInstanceTags`/`store.listInstanceMeta` (Task 2).
- Produces: `launchDefinition(deps, definitionId, requestedName?, sessionName?, opener?, tags?: string[])` — normalizes `tags`, folds them into the auto-generated name, drops fixed-host-port forwards when a prior instance of the definition exists, and persists the normalized tags for the new instance name.

- [ ] **Step 1: Write the failing test**

Create `tests/main/launch.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { launchDefinition, type LaunchDeps } from '@main/launch'
import { openStore, type Store } from '@main/store/db'
import type { DefinitionSpec } from '@shared/types'

function insertDef(store: Store, id: string, name: string): void {
  const spec: DefinitionSpec = {
    definition: { id, name, description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: new Date().toISOString() },
    mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
    domains: [],
    ports: [{ hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: '' }, { hostPort: null, containerPort: 9229, protocol: 'tcp', label: '' }],
    hostServices: [], credentials: []
  }
  store.insertDefinitionSpec(spec)
}

function deps(store: Store, opened: string[]): LaunchDeps {
  return {
    adapter: {
      listSandboxes: async () => [],
      setSecret: async () => {}, setCustomSecret: async () => {}, setRegistrySecret: async () => {},
      checkDockerAuth: async () => 'ok'
    } as never,
    store,
    creds: { getStaged: () => null },
    materializeKit: () => undefined,
    openTerminal: (cmd: string) => opened.push(cmd),
    genHash: () => 'deadbeef'
  }
}

describe('launchDefinition tags + port skip', () => {
  it('folds tags into the instance name', async () => {
    const store = openStore(':memory:')
    insertDef(store, 'd1', 'My Proj')
    const opened: string[] = []
    const { name } = await launchDefinition(deps(store, opened), 'd1', undefined, undefined, 'terminal', ['prod', 'eu'])
    expect(name).toBe('myproj-prod-eu-deadbeef')
    expect(store.listInstanceTags().get('myproj-prod-eu-deadbeef')).toEqual(['prod', 'eu'])
  })

  it('publishes all ports for the first instance', async () => {
    const store = openStore(':memory:')
    insertDef(store, 'd1', 'proj')
    const opened: string[] = []
    await launchDefinition(deps(store, opened), 'd1', undefined, undefined, 'terminal', [])
    expect(opened[0]).toContain('8080:3000')
    expect(opened[0]).toContain('9229/tcp')
  })

  it('skips fixed host-port forwards on the second instance', async () => {
    const store = openStore(':memory:')
    insertDef(store, 'd1', 'proj')
    const opened: string[] = []
    const d = deps(store, opened)
    await launchDefinition(d, 'd1', undefined, undefined, 'terminal', [])   // first
    await launchDefinition(d, 'd1', undefined, undefined, 'terminal', [])   // second
    expect(opened[1]).not.toContain('8080:3000')
    expect(opened[1]).toContain('9229/tcp')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/launch.test.ts`
Expected: FAIL — `launchDefinition` ignores the `tags` argument / name lacks tags.

- [ ] **Step 3: Wire tags + skip into `launchDefinition`**

In `src/main/launch.ts`:

Update the imports at the top:

```ts
import { resolveSandboxName, hashedSandboxName, launchCommand, portsForLaunch } from './sbx/translate'
import { composeInstanceBaseName, toSbxName } from '@shared/names'
import { normalizeTags } from '@shared/tags'
```

(Remove the separate `import { toSbxName } from '@shared/names'` line if present — fold it into the line above. `resolveSandboxName` is still used elsewhere via translate; keep it imported.)

Change the signature to accept `tags`:

```ts
export async function launchDefinition(
  deps: LaunchDeps,
  definitionId: string,
  requestedName?: string,
  sessionName?: string,
  opener: 'terminal' | 'vscode' = 'terminal',
  rawTags: string[] = []
): Promise<{ name: string }> {
```

Immediately after `if (!spec) throw …`, normalize the tags:

```ts
  const tags = normalizeTags(rawTags)
```

Replace the base-name line:

```ts
  const base = requestedName && requestedName.trim() ? toSbxName(requestedName) : composeInstanceBaseName(spec.definition.name, tags)
```

After the `name` is resolved (`const name = hashedSandboxName(...)`), determine whether this is a subsequent launch and compute the port list:

```ts
  const priorInstances = deps.store.listInstanceMeta().filter((m) => m.definitionId === definitionId).length
  const isSubsequent = priorInstances >= 1
  const ports = portsForLaunch(spec.ports, isSubsequent)
  if (isSubsequent && ports.length < spec.ports.length) {
    deps.log?.info(`Instance #${priorInstances + 1} of definition ${definitionId}: skipping ${spec.ports.length - ports.length} fixed host-port forward(s) to avoid conflicts. Add corrected ports from the instance's Ports tab.`)
  }
```

Pass `ports` into `launchCommand`:

```ts
  const command = launchCommand(spec, name, sessionName, kitDir, ports)
```

Finally, after the existing `deps.store.upsertInstanceMeta({...})` call, persist the tags:

```ts
  deps.store.setInstanceTags(name, tags)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/launch.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full main suite**

Run: `npm run typecheck && npx vitest run tests/main`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/launch.ts tests/main/launch.test.ts
git commit -m "feat(launch): fold tags into name, skip fixed ports on 2nd+ instance, persist tags"
```

---

## Task 6: IPC + preload + client — thread tags, add setTags, carry tags on rebuild

**Files:**
- Modify: `src/main/ipc.ts` (`buildHandlers` type block ~98-140, handlers ~152-390, `instance:rebuild` ~244-253, `registerIpc` ~433-475)
- Modify: `src/preload/index.ts` (~16, add setTags)
- Modify: `src/renderer/ipc/client.ts` (`Api` ~3-48, fallback ~50-95)
- Test: `tests/main/ipc-tags.test.ts`

**Interfaces:**
- Consumes: `launchDefinition(…, tags)` (Task 5), `store.setInstanceTags`/`store.listInstanceTags` (Task 2), `normalizeTags` (Task 1).
- Produces:
  - IPC `instance:launch(definitionId, name?, sessionName?, opener?, tags?)`.
  - IPC `instance:setTags(name, tags)` → `Result<null>`.
  - preload `instanceLaunch(definitionId, name?, sessionName?, opener?, tags?)`, `instanceSetTags(name, tags)`.
  - client `api.instanceSetTags`, updated `api.instanceLaunch`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/ipc-tags.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildHandlers } from '@main/ipc'
import { openStore, type Store } from '@main/store/db'

function baseDeps(store: Store) {
  return {
    adapter: {
      listSandboxes: async () => [],
      setSecret: async () => {}, setCustomSecret: async () => {}, setRegistrySecret: async () => {},
      checkDockerAuth: async () => 'ok'
    } as never,
    store,
    probes: {} as never,
    openTerminal: () => {},
    materializeKit: () => undefined,
    genHash: () => 'cafebabe'
  }
}

describe('instance:setTags', () => {
  it('normalizes and stores tags for an instance', async () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'proj-a1', definitionId: null, createdByApp: true, createdAt: new Date().toISOString(), credFingerprint: null })
    const h = buildHandlers(baseDeps(store))
    const res = await h['instance:setTags']('proj-a1', [' Prod ', 'prod', 'eu'])
    expect(res.ok).toBe(true)
    expect(store.listInstanceTags().get('proj-a1')).toEqual(['Prod', 'eu'])
  })
})

describe('instance:launch tags', () => {
  it('passes tags through to the launched instance name', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({
      definition: { id: 'd1', name: 'proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: new Date().toISOString() },
      mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    })
    const h = buildHandlers(baseDeps(store))
    const res = await h['instance:launch']('d1', undefined, undefined, 'terminal', ['prod'])
    expect(res.ok && res.data.name).toBe('proj-prod-cafebabe')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/ipc-tags.test.ts`
Expected: FAIL — `h['instance:setTags'] is not a function` and launch ignores tags.

- [ ] **Step 3: Update `buildHandlers` — types, launch, setTags, rebuild**

In `src/main/ipc.ts`:

Add the import:

```ts
import { normalizeTags } from '@shared/tags'
```

In the `buildHandlers` return type block, change the `instance:launch` line and add `instance:setTags`:

```ts
  'instance:launch': (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[]) => Promise<Result<{ name: string }>>
  'instance:setTags': (name: string, tags: string[]) => Promise<Result<null>>
```

Change the `'instance:launch'` handler to forward `tags`:

```ts
    'instance:launch': (definitionId, name, sessionName, opener, tags) => wrap(() => launchDefinition(
      launchDeps(),
      definitionId, name, sessionName, opener ?? 'terminal', tags ?? []
    )),
```

Add the `'instance:setTags'` handler (place it right after `'instance:launch'`):

```ts
    'instance:setTags': (name, tags) => wrap(async () => { deps.store.setInstanceTags(name, normalizeTags(tags)); return null }),
```

Update `'instance:rebuild'` so tags survive the recreate (the new sandbox gets a fresh name). Read the old tags before `cleanupInstance` deletes the meta+tags, then pass them to the new launch:

```ts
    'instance:rebuild': (name, opener) => wrap(async () => {
      const { definitionId } = await resolveInstanceDefinition(deps, name)
      if (!definitionId) throw new SbxError('not-found', `Instance "${name}" has no linked definition to rebuild from.`)
      const tags = deps.store.listInstanceTags().get(name) ?? []
      deps.log?.info(`Rebuilding instance "${name}" (recreate from definition ${definitionId} to apply current config/credentials).`)
      await cleanupInstance(deps, name)
      return launchDefinition(launchDeps(), definitionId, undefined, undefined, opener ?? 'terminal', tags)
    }),
```

- [ ] **Step 4: Register the new/changed channels**

In `registerIpc`, update the `instance:launch` registration to pass the 5th arg and add `instance:setTags`:

```ts
  ipcMain.handle('instance:launch', (_e, id: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[]) => handlers['instance:launch'](id, name, sessionName, opener, tags))
  ipcMain.handle('instance:setTags', (_e, name: string, tags: string[]) => handlers['instance:setTags'](name, tags))
```

- [ ] **Step 5: Run the IPC test**

Run: `npx vitest run tests/main/ipc-tags.test.ts`
Expected: PASS.

- [ ] **Step 6: Update preload**

In `src/preload/index.ts`, change `instanceLaunch` and add `instanceSetTags`:

```ts
  instanceLaunch: (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[]) => ipcRenderer.invoke('instance:launch', definitionId, name, sessionName, opener, tags),
```

Add after `instanceRemove`:

```ts
  instanceSetTags: (name: string, tags: string[]) => ipcRenderer.invoke('instance:setTags', name, tags),
```

- [ ] **Step 7: Update the renderer client type + fallback**

In `src/renderer/ipc/client.ts`, in the `Api` interface change `instanceLaunch` and add `instanceSetTags`:

```ts
  instanceLaunch(definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[]): Promise<Result<{ name: string }>>
  instanceSetTags(name: string, tags: string[]): Promise<Result<null>>
```

In the fallback object (the `?? { … }` stub), add:

```ts
  instanceSetTags: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
```

- [ ] **Step 8: Typecheck + full main suite**

Run: `npm run typecheck && npx vitest run tests/main`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc-tags.test.ts
git commit -m "feat(ipc): thread tags through launch, add instance:setTags, carry tags on rebuild"
```

---

## Task 7: `TagInput` reusable chip component

**Files:**
- Create: `src/renderer/components/TagInput.tsx`
- Test: `tests/renderer/TagInput.test.tsx`

**Interfaces:**
- Produces: `TagInput({ tags, onChange, placeholder?, ariaLabel? })` — controlled chip input. Enter or comma commits the draft as a tag; ✕ removes a chip; duplicate (case-insensitive) drafts are ignored.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/TagInput.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TagInput } from '../../src/renderer/components/TagInput'

describe('TagInput', () => {
  it('adds a tag on Enter', () => {
    const onChange = vi.fn()
    render(<TagInput tags={[]} onChange={onChange} ariaLabel="Tags" />)
    const input = screen.getByLabelText('Tags')
    fireEvent.change(input, { target: { value: 'prod' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['prod'])
  })
  it('ignores a case-insensitive duplicate', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['prod']} onChange={onChange} ariaLabel="Tags" />)
    const input = screen.getByLabelText('Tags')
    fireEvent.change(input, { target: { value: 'PROD' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })
  it('removes a tag via its remove button', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['prod', 'eu']} onChange={onChange} ariaLabel="Tags" />)
    fireEvent.click(screen.getByLabelText('Remove tag prod'))
    expect(onChange).toHaveBeenCalledWith(['eu'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/TagInput.test.tsx`
Expected: FAIL — cannot find module `TagInput`.

- [ ] **Step 3: Implement `src/renderer/components/TagInput.tsx`**

```tsx
import { useState } from 'react'

/**
 * Controlled free-form tag chip input. Enter or comma commits the current draft;
 * the ✕ on a chip removes it. Case-insensitive duplicates are ignored. Purely
 * presentational — normalization/limits are enforced by the main process on write.
 */
export function TagInput({ tags, onChange, placeholder, ariaLabel }: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  ariaLabel?: string
}): JSX.Element {
  const [draft, setDraft] = useState('')

  function commit(raw: string): void {
    const t = raw.trim()
    if (!t) return
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) { setDraft(''); return }
    onChange([...tags, t])
    setDraft('')
  }
  function remove(tag: string): void {
    onChange(tags.filter((x) => x !== tag))
  }

  return (
    <div className="tag-input" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      {tags.map((tag) => (
        <span key={tag} className="tag-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, background: 'var(--accent-soft, rgba(0,120,255,.12))', color: 'var(--accent)', borderRadius: 999, padding: '2px 8px' }}>
          {tag}
          <button type="button" className="tag-remove" aria-label={`Remove tag ${tag}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }} onClick={() => remove(tag)}>✕</button>
        </span>
      ))}
      <input
        className="input"
        aria-label={ariaLabel ?? 'Tags'}
        style={{ flex: 1, minWidth: 100, border: 'none', outline: 'none', background: 'none', fontSize: 13 }}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value
          if (v.endsWith(',')) commit(v.slice(0, -1)) // comma commits
          else setDraft(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
          else if (e.key === 'Backspace' && draft === '' && tags.length > 0) remove(tags[tags.length - 1])
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/TagInput.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TagInput.tsx tests/renderer/TagInput.test.tsx
git commit -m "feat(ui): reusable TagInput chip component"
```

---

## Task 8: LaunchDialog — tags input + port-skip note

**Files:**
- Modify: `src/renderer/components/LaunchDialog.tsx`
- Modify: `src/renderer/i18n/en.ts` (`launch` block ~96-110), `src/renderer/i18n/de.ts` (matching `launch` block)
- Test: `tests/renderer/LaunchDialog.test.tsx`

**Interfaces:**
- Consumes: `TagInput` (Task 7).
- Produces: `LaunchDialog` with new props `willSkipFixedPorts: boolean` and `instanceNumber: number`; `onLaunch` signature becomes `(sessionName: string, opener: 'terminal' | 'vscode', tags: string[]) => void`.

- [ ] **Step 1: Add i18n keys**

In `src/renderer/i18n/en.ts`, inside the `launch: { … }` object, add:

```ts
    tagsLabel: 'Tags (optional)',
    tagsPlaceholder: 'e.g. prod, eu — Enter to add',
    tagsSub: 'Tags help you organize and filter instances, and are added to the instance name.',
    portSkipNote: 'This is instance #{number} for this definition — fixed host-port forwards are skipped to avoid conflicts. Add a corrected port later from the instance’s Ports tab.',
```

In `src/renderer/i18n/de.ts`, add the same keys under its `launch` object (translated, or English copy if no translation):

```ts
    tagsLabel: 'Tags (optional)',
    tagsPlaceholder: 'z. B. prod, eu — Enter zum Hinzufügen',
    tagsSub: 'Tags helfen beim Organisieren und Filtern von Instanzen und werden dem Instanznamen hinzugefügt.',
    portSkipNote: 'Dies ist Instanz #{number} dieser Definition — feste Host-Port-Weiterleitungen werden übersprungen, um Konflikte zu vermeiden. Füge einen korrigierten Port später im Ports-Tab der Instanz hinzu.',
```

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/LaunchDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LaunchDialog } from '../../src/renderer/components/LaunchDialog'
import type { Definition } from '@shared/types'

const def: Definition = { id: 'd1', name: 'Proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: '' }

describe('LaunchDialog tags + skip note', () => {
  it('passes entered tags to onLaunch', () => {
    const onLaunch = vi.fn()
    render(<LaunchDialog definition={def} hasVSCode={false} cloneMode={false} willSkipFixedPorts={false} instanceNumber={1} onLaunch={onLaunch} onCancel={() => {}} />)
    const tagInput = screen.getByLabelText('Instance tags')
    fireEvent.change(tagInput, { target: { value: 'prod' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    fireEvent.click(screen.getByText('Launch'))
    expect(onLaunch).toHaveBeenCalledWith('', 'terminal', ['prod'])
  })
  it('shows the port-skip note when willSkipFixedPorts is true', () => {
    render(<LaunchDialog definition={def} hasVSCode={false} cloneMode={false} willSkipFixedPorts={true} instanceNumber={2} onLaunch={() => {}} onCancel={() => {}} />)
    expect(screen.getByText(/fixed host-port forwards are skipped/i)).toBeTruthy()
  })
  it('hides the note on the first instance', () => {
    render(<LaunchDialog definition={def} hasVSCode={false} cloneMode={false} willSkipFixedPorts={false} instanceNumber={1} onLaunch={() => {}} onCancel={() => {}} />)
    expect(screen.queryByText(/fixed host-port forwards are skipped/i)).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/renderer/LaunchDialog.test.tsx`
Expected: FAIL — `willSkipFixedPorts` prop not accepted / no tags input.

- [ ] **Step 4: Update `LaunchDialog`**

In `src/renderer/components/LaunchDialog.tsx`:

Add the import and `useState` (already imported). Import `TagInput`:

```ts
import { TagInput } from './TagInput'
```

Change the props and `onLaunch` signature:

```ts
export function LaunchDialog({ definition, hasVSCode, cloneMode, willSkipFixedPorts, instanceNumber, onLaunch, onCancel }: {
  definition: Definition
  hasVSCode: boolean
  cloneMode: boolean
  willSkipFixedPorts: boolean
  instanceNumber: number
  onLaunch: (sessionName: string, opener: 'terminal' | 'vscode', tags: string[]) => void
  onCancel: () => void
}): JSX.Element {
```

Add tags state next to `sessionName`:

```ts
  const [tags, setTags] = useState<string[]>([])
```

Change `submit` to pass tags:

```ts
  function submit(): void {
    onLaunch(sessionName.trim(), opener, tags)
  }
```

In the JSX, after the session-name `<p>` (`launch.sessionSub`) and before the Open-With label, add the tags field and skip note:

```tsx
        <label style={labelStyle}>{t('launch.tagsLabel')}</label>
        <TagInput tags={tags} onChange={setTags} placeholder={t('launch.tagsPlaceholder')} ariaLabel="Instance tags" />
        <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0 }}>{t('launch.tagsSub')}</p>
        {willSkipFixedPorts && (
          <p role="note" className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-3)', color: 'var(--warning, #b8860b)' }}>
            {t('launch.portSkipNote', { number: instanceNumber })}
          </p>
        )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/LaunchDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck (App.tsx will now error — fixed in Task 10)**

Run: `npx vitest run tests/renderer/LaunchDialog.test.tsx`
Expected: PASS. Note: `npm run typecheck` will fail on `App.tsx`'s `<LaunchDialog>` usage until Task 10 — that's expected; do not "fix" it here beyond this component.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/LaunchDialog.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/LaunchDialog.test.tsx
git commit -m "feat(ui): LaunchDialog tags input + port-skip note"
```

---

## Task 9: Instances screen — tag chips + tag filter bar

**Files:**
- Modify: `src/renderer/screens/Instances.tsx`
- Modify: `src/renderer/i18n/en.ts` (`instances` block), `src/renderer/i18n/de.ts` (matching block)
- Test: `tests/renderer/Instances.tags.test.tsx`

**Interfaces:**
- Consumes: `InstanceView.tags` (Task 3).
- Produces: `Instances` renders a tag column and a filter bar; filtering is internal component state (OR semantics). No prop-signature change to `Instances` (filter state lives inside).

- [ ] **Step 1: Add i18n keys**

In `src/renderer/i18n/en.ts`, inside `instances: { … }`, add:

```ts
    colTags: 'Tags',
    filterByTags: 'Filter by tag:',
    filterClear: 'Clear filter',
    noTags: 'No tags',
```

In `src/renderer/i18n/de.ts`, inside its `instances` block, add:

```ts
    colTags: 'Tags',
    filterByTags: 'Nach Tag filtern:',
    filterClear: 'Filter zurücksetzen',
    noTags: 'Keine Tags',
```

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/Instances.tags.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Instances } from '../../src/renderer/screens/Instances'
import type { InstanceView } from '@shared/types'

function inst(name: string, tags: string[]): InstanceView {
  return { name, status: 'running', agent: 'claude', workspace: null, ports: [], definitionId: 'd1', definitionName: 'Proj', tier: 'open', tags }
}

const data = [inst('proj-prod-1', ['prod']), inst('proj-eu-1', ['eu']), inst('proj-x', [])]

describe('Instances tag filter', () => {
  it('renders each instance tag as a chip', () => {
    render(<Instances instances={data} />)
    expect(screen.getAllByText('prod').length).toBeGreaterListThan?.(0) ?? expect(screen.getAllByText('prod').length).toBeGreaterThan(0)
  })
  it('filters rows to instances having the selected tag (OR)', () => {
    render(<Instances instances={data} />)
    // The filter bar exposes a toggle per distinct tag.
    fireEvent.click(screen.getByRole('button', { name: 'Filter tag prod' }))
    const table = screen.getByRole('table')
    expect(within(table).queryByText('proj-prod-1')).toBeTruthy()
    expect(within(table).queryByText('proj-eu-1')).toBeNull()
    expect(within(table).queryByText('proj-x')).toBeNull()
  })
})
```

Note: replace the first test's assertion with the simpler form — use:

```tsx
  it('renders each instance tag as a chip', () => {
    render(<Instances instances={data} />)
    expect(screen.getAllByText('prod').length).toBeGreaterThan(0)
  })
```

(Delete the `.toBeGreaterListThan` line — it was illustrative; keep only the `.toBeGreaterThan(0)` assertion.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/renderer/Instances.tags.test.tsx`
Expected: FAIL — no tag chips / no filter buttons.

- [ ] **Step 4: Implement tags column + filter bar**

In `src/renderer/screens/Instances.tsx`:

Add `useState` import and derive the distinct tags + filtered rows. At the top of the component (after `const t = useT()`), add:

```tsx
  const [selected, setSelected] = useState<string[]>([])
  const allTags = Array.from(new Set(instances.flatMap((i) => i.tags))).sort((a, b) => a.localeCompare(b))
  const shown = selected.length === 0 ? instances : instances.filter((i) => i.tags.some((tag) => selected.includes(tag)))
  function toggleTag(tag: string): void {
    setSelected((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
  }
```

Add the import at the top of the file:

```tsx
import { useState } from 'react'
```

Render the filter bar just below the `<p className="section-desc">` subtitle (only when there are tags to filter by):

```tsx
      {allTags.length > 0 && (
        <div className="tag-filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('instances.filterByTags')}</span>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-label={`Filter tag ${tag}`}
              aria-pressed={selected.includes(tag)}
              className="btn btn-sm"
              style={{ fontSize: 12, borderRadius: 999, background: selected.includes(tag) ? 'var(--accent)' : 'var(--surface)', color: selected.includes(tag) ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
              onClick={() => toggleTag(tag)}
            >{tag}</button>
          ))}
          {selected.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setSelected([])}>{t('instances.filterClear')}</button>
          )}
        </div>
      )}
```

Add a `Tags` column header — in the `<thead>` row, add a `<th>` (e.g. after the Definition column header):

```tsx
                <th>{t('instances.colTags')}</th>
```

Replace `instances.map(...)` in `<tbody>` with `shown.map(...)`, and add a tags cell in each row (mirror the placement of the header). Inside the row, after the definition cell, add:

```tsx
                  <td>
                    {i.tags.length === 0 ? dash : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {i.tags.map((tag) => (
                          <span key={tag} style={{ fontSize: 11, background: 'var(--accent-soft, rgba(0,120,255,.12))', color: 'var(--accent)', borderRadius: 999, padding: '1px 7px' }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </td>
```

(The empty-state block that renders when `instances.length === 0` stays keyed on `instances`, not `shown`, so an all-filtered-out table still shows its headers and filter bar.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/renderer/Instances.tags.test.tsx`
Expected: PASS.

- [ ] **Step 6: Guard existing Instances tests**

Run: `npx vitest run tests/renderer/Instances.test.tsx tests/renderer/Instances.actions.test.tsx`
Expected: PASS. If an existing test builds an `InstanceView` literal without `tags`, add `tags: []` to it (Task 3 made `tags` required).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/screens/Instances.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/Instances.tags.test.tsx
git commit -m "feat(ui): Instances tag chips + OR tag-filter bar"
```

---

## Task 10: InstanceDetail tags editor + App wiring + i18n

**Files:**
- Modify: `src/renderer/screens/InstanceDetail.tsx`
- Modify: `src/renderer/App.tsx` (`submitLaunch` ~145-161, `openLaunchDialog` ~131-143, LaunchDialog usage ~276-284, InstanceDetail usage ~226-237, new `onSetTags`)
- Modify: `src/renderer/i18n/en.ts` (`detail` block ~256+), `src/renderer/i18n/de.ts` (matching block)
- Test: `tests/renderer/detail/InstanceDetail.tags.test.tsx`

**Interfaces:**
- Consumes: `TagInput` (Task 7), `api.instanceSetTags` (Task 6), updated `LaunchDialog` props (Task 8), `InstanceView.tags` (Task 3).
- Produces: `InstanceDetail` gains prop `onSetTags: (name: string, tags: string[]) => void`; `App` computes and passes `willSkipFixedPorts`/`instanceNumber` to `LaunchDialog`, threads `tags` through `submitLaunch`, and wires `onSetTags`.

- [ ] **Step 1: Add i18n keys**

In `src/renderer/i18n/en.ts`, inside `detail: { … }`, add:

```ts
    tagsTitle: 'Tags',
    tagsHint: 'Organize and filter this instance. Changes apply immediately.',
    tagsPlaceholder: 'Add a tag — Enter to confirm',
```

In `src/renderer/i18n/de.ts`, inside its `detail` block, add:

```ts
    tagsTitle: 'Tags',
    tagsHint: 'Diese Instanz organisieren und filtern. Änderungen werden sofort übernommen.',
    tagsPlaceholder: 'Tag hinzufügen — Enter zum Bestätigen',
```

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/detail/InstanceDetail.tags.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InstanceDetail } from '../../../src/renderer/screens/InstanceDetail'
import type { InstanceView } from '@shared/types'

const instance: InstanceView = { name: 'proj-a1', status: 'running', agent: 'claude', workspace: null, ports: [], definitionId: 'd1', definitionName: 'Proj', tier: 'open', tags: ['prod'] }

function noop(): void {}

describe('InstanceDetail tags editor', () => {
  it('calls onSetTags when a tag is added', () => {
    const onSetTags = vi.fn()
    render(
      <InstanceDetail
        instance={instance} hasVSCode={false}
        onBack={noop} onStop={noop} onRemove={noop} onRebuild={noop}
        onApplyCredentials={noop} onAttach={noop} onShell={noop} onSetTags={onSetTags}
      />
    )
    const tagInput = screen.getByLabelText('Edit instance tags')
    fireEvent.change(tagInput, { target: { value: 'eu' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    expect(onSetTags).toHaveBeenCalledWith('proj-a1', ['prod', 'eu'])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/renderer/detail/InstanceDetail.tags.test.tsx`
Expected: FAIL — `onSetTags` prop not accepted / no tags editor.

- [ ] **Step 4: Add the tags editor to `InstanceDetail`**

In `src/renderer/screens/InstanceDetail.tsx`:

Add the import:

```ts
import { TagInput } from '../components/TagInput'
```

Add `onSetTags` to the props type and destructuring:

```ts
  onShell: (name: string) => void
  onSetTags: (name: string, tags: string[]) => void
```
(add `onSetTags` to the destructured params list too.)

Add local tag state synced to the instance, after the other `useState` hooks:

```ts
  const [tags, setTags] = useState<string[]>(instance.tags)
  useEffect(() => { setTags(instance.tags) }, [instance.name, instance.tags])
```

Render the editor in the header area — right after the `detail-header` `</div>` (before the `credsDrift` banner), add:

```tsx
      <div className="card" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 'var(--space-2)' }}>{t('detail.tagsTitle')}</div>
        <TagInput
          tags={tags}
          onChange={(next) => { setTags(next); onSetTags(instance.name, next) }}
          placeholder={t('detail.tagsPlaceholder')}
          ariaLabel="Edit instance tags"
        />
        <p className="section-desc" style={{ fontSize: 11, margin: '6px 0 0' }}>{t('detail.tagsHint')}</p>
      </div>
```

- [ ] **Step 5: Run the detail test**

Run: `npx vitest run tests/renderer/detail/InstanceDetail.tags.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire `App.tsx` — launch tags, skip-note data, onSetTags**

In `src/renderer/App.tsx`:

Add state for the launch definition's fixed-port info, near the other launch state:

```ts
  const [launchHasFixedPorts, setLaunchHasFixedPorts] = useState(false)
```

In `openLaunchDialog`, set it from the fetched spec (reuse the existing `specR`):

```ts
    const specR = await api.defGetSpec(def.id)
    setLaunchCloneMode(specR.ok && !!specR.data && ((specR.data.mounts.find((m) => m.isPrimary) ?? specR.data.mounts[0])?.mode === 'clone'))
    setLaunchHasFixedPorts(specR.ok && !!specR.data && specR.data.ports.some((p) => p.hostPort !== null))
    setLaunchFor(def)
```

Change `submitLaunch` to accept and forward `tags`:

```ts
  async function submitLaunch(definition: Definition, sessionName: string, opener: 'terminal' | 'vscode', tags: string[]): Promise<void> {
    setLaunchFor(null)
    setNotice(null)
    setBusyId(definition.id)
    try {
      const r = await api.instanceLaunch(definition.id, undefined, sessionName, opener, tags)
      if (r.ok) {
        setNotice({ kind: 'info', text: t('instances.launched', { name: r.data.name }) })
        setScreen('instances')
        await loadInstances()
      } else {
        setNotice({ kind: 'error', text: t('instances.actionFailed', { message: r.error.message }) })
      }
    } finally {
      setBusyId(null)
    }
  }
```

Add an `onSetTags` handler (near `onApplyCredentials`):

```ts
  async function onSetTags(name: string, tags: string[]): Promise<void> {
    const r = await api.instanceSetTags(name, tags)
    if (!r.ok && r.error) setNotice({ kind: 'error', text: t('instances.actionFailed', { message: r.error.message }) })
    await loadInstances()
  }
```

Update the `<LaunchDialog>` usage to compute the skip-note inputs and pass tags through:

```tsx
      {launchFor && (() => {
        const existingCount = instances.filter((i) => i.definitionId === launchFor.id).length
        return (
          <LaunchDialog
            definition={launchFor}
            hasVSCode={hasVSCode}
            cloneMode={launchCloneMode}
            willSkipFixedPorts={existingCount >= 1 && launchHasFixedPorts}
            instanceNumber={existingCount + 1}
            onLaunch={(session, opener, tags) => void submitLaunch(launchFor, session, opener, tags)}
            onCancel={() => setLaunchFor(null)}
          />
        )
      })()}
```

Update the `<InstanceDetail>` usage to pass `onSetTags`:

```tsx
            onApplyCredentials={(name) => void onApplyCredentials(name)}
            onSetTags={(name, tags) => void onSetTags(name, tags)}
```

- [ ] **Step 7: Full typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS. If `tests/renderer/App.test.tsx` or `App.nav.test.tsx` construct `InstanceView` literals or call `submitLaunch`/`LaunchDialog` with the old shapes, update them: add `tags: []` to `InstanceView` literals and the third `tags` arg where `onLaunch` is exercised.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/screens/InstanceDetail.tsx src/renderer/App.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/detail/InstanceDetail.tags.test.tsx tests/renderer/App.test.tsx tests/renderer/App.nav.test.tsx
git commit -m "feat(ui): InstanceDetail tags editor + App wiring for tags and port-skip note"
```

---

## Task 11: Documentation + final verification

**Files:**
- Modify: `docs/ARCHITECTURE.md` (SQLite schema section ~149-219; store/reconciler/launch rows in the module map)

- [ ] **Step 1: Update the architecture doc**

In `docs/ARCHITECTURE.md`:
- Add `instance_tag` to the `store/db.ts` row description (child table list) and to the ER-diagram narrative (an `instance_tag` table keyed by `sbx_name`, replaced on write, cascade-deleted with `instance_meta`).
- In the `reconciler.ts` row, note it now also attaches per-instance `tags`.
- In the `launch.ts` row, note the name is composed from the definition slug + tags and that fixed host-port forwards are skipped on the 2nd+ instance of a definition.

Add an `instance_tag` entry to the Mermaid `erDiagram` block:

```
    instance_meta ||--o{ instance_tag : "tags"
    instance_tag {
        text sbx_name PK
        text tag PK
    }
```

- [ ] **Step 2: Final full verification**

Run: `npm run typecheck && npm test`
Expected: PASS — all suites green.

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: record instance_tag table, tag-composed names, and port-skip in architecture"
```

---

## Self-Review

**Spec coverage:**
- Storage (`instance_tag`, `InstanceView.tags`, GC cascade) → Tasks 2, 3.
- Store/IPC (`setInstanceTags`/`listInstanceTags`, `instance:launch` tags, `instance:setTags`) → Tasks 2, 6.
- Launch: tags folded into name (§3a), 2nd+ instance skips fixed-host-port forwards, ephemeral kept, tags persisted → Tasks 4, 5.
- Naming: `<def-slug>-<tags>-<hash>`, length-capped, explicit-name override → Tasks 1, 5.
- UI: LaunchDialog tag input + skip note; Instances tag chips + OR filter; Instance Detail tag editor → Tasks 7, 8, 9, 10.
- Rebuild carries tags (interaction not in spec but required so tags survive recreate) → Task 6.
- Known interaction (PortsTab dual-write left as-is) → no code change; documented in spec, intentionally untouched.
- Normalization limits (10 tags / 32 chars, trim, dedupe) → Task 1, enforced main-side in Tasks 5, 6.
- Testing across store/launch/reconcile/renderer → every task ships tests.
- Migration (additive table, `user_version` bump) → Task 2.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code and test step carries real content. (The one illustrative bad assertion in Task 9 Step 2 is explicitly corrected in the same step.)

**Type consistency:** `normalizeTags`, `composeInstanceBaseName`, `portsForLaunch`, `setInstanceTags`/`listInstanceTags`, `instanceSetTags`, and the `LaunchDialog`/`InstanceDetail` prop signatures are named identically across the tasks that define and consume them. `InstanceView.tags` is added (required) in Task 3, and Tasks 9/10 note the fallout at every `InstanceView`-literal construction site.
