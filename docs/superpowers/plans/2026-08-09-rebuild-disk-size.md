# Adjust disk size when rebuilding an instance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user change an instance's disk/volume size when rebuilding it, pre-filled with the size that instance was created with.

**Architecture:** Persist the disk size each instance was created with (new `instance_meta.disk_size`, recorded by `launchDefinition`), surface it on `InstanceView` via `reconcile`, and give Rebuild its own dialog with an editable disk-size field. The value is threaded through `instance:rebuild` as the override that `launchDefinition` already knows how to apply (from PR #13). No new sbx mechanics — rebuild is the only path that recreates the volume.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React, better-sqlite3, Vitest, `@testing-library/react`.

## Global Constraints

- Disk-size format reuses the memory validator `isValidDiskSize`/`parseDiskSize` from `@shared/resources`. Empty = "Docker's 50 GB default".
- The store migration is a NEW guarded block bumping `PRAGMA user_version` from `12` to `13`; do not retrofit the definition disk_size (v11→v12) block.
- Reuse existing i18n keys — `launch.diskSizeLabel` / `launch.diskSizePlaceholder` / `launch.diskSizeInvalid` and `instances.rebuildTitle` / `instances.rebuildBody` / `instances.confirmRebuild` / `instances.cancel`. **No new i18n keys** (keeps en/de parity untouched).
- Pre-fill precedence is `instance.diskSize ?? definitionDefault ?? ''`. An empty override resolves (via `parseDiskSize('')`) to `undefined` → Docker default; the definition-default fallback is what preserves today's rebuild behavior for instances whose size we never recorded.
- Run `npm run typecheck` and `npm test` before claiming complete (CLAUDE.md).
- Environment: the better-sqlite3 native module is ABI-locked while the app runs, and Node 25 has no node-ABI prebuild on this machine — so main-process suites that construct a real `Database` (e.g. `store/db.test.ts`, `ipc-tags.test.ts`, `reconciler.test.ts` if it uses `openStore`) may not run locally. Verify those via `npm run typecheck` plus close review; renderer/shared suites and mock-store main tests (e.g. `launch.test.ts`) run fine. In CI they run normally.

---

## File Structure

- `src/shared/types.ts` — `diskSize?` on `InstanceMeta` and `InstanceView`.
- `src/main/store/db.ts` — `instance_meta.disk_size` column, migration v12→v13, upsert/list threading.
- `src/main/launch.ts` — record `diskSize` on the instance-meta upsert.
- `src/main/reconciler.ts` — carry `diskSize` onto `InstanceView`.
- `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/ipc/client.ts` — thread `diskSize` through `instance:rebuild`.
- `src/renderer/components/RebuildDialog.tsx` (new) — rebuild dialog + editable disk-size field + the `rebuildInitialDiskSize` precedence helper.
- `src/renderer/App.tsx` — async rebuild-open (compute pre-fill), render `RebuildDialog`, thread `diskSize`.

Tests: `tests/main/store/db.test.ts`, `tests/main/launch.test.ts`, `tests/main/reconciler.test.ts`, `tests/main/ipc-tags.test.ts`, `tests/renderer/RebuildDialog.test.tsx` (new).

---

### Task 1: Persist per-instance disk size (types + store)

**Files:**
- Modify: `src/shared/types.ts` (`InstanceMeta`, `InstanceView`)
- Modify: `src/main/store/db.ts` (schema, migration, `upsertInstanceMeta`, `listInstanceMeta`)
- Test: `tests/main/store/db.test.ts`

**Interfaces:**
- Produces: `InstanceMeta.diskSize?: string`, `InstanceView.diskSize?: string`; the store round-trips `diskSize` via `upsertInstanceMeta`/`listInstanceMeta`.

- [ ] **Step 1: Write the failing test**

Append to `tests/main/store/db.test.ts` inside the `describe('metadata-store', …)` block:

```ts
it('round-trips diskSize on instance metadata', () => {
  const store = openStore(':memory:')
  store.upsertInstanceMeta({ sbxName: 'sbx-d', definitionId: null, createdByApp: true, createdAt: 't', diskSize: '20g' })
  expect(store.listInstanceMeta().find((m) => m.sbxName === 'sbx-d')?.diskSize).toBe('20g')
  // overwrite via ON CONFLICT
  store.upsertInstanceMeta({ sbxName: 'sbx-d', definitionId: null, createdByApp: true, createdAt: 't2', diskSize: '40g' })
  expect(store.listInstanceMeta().find((m) => m.sbxName === 'sbx-d')?.diskSize).toBe('40g')
  store.close()
})

it('reads diskSize as undefined when never set', () => {
  const store = openStore(':memory:')
  store.upsertInstanceMeta({ sbxName: 'sbx-n', definitionId: null, createdByApp: true, createdAt: 't' })
  expect(store.listInstanceMeta().find((m) => m.sbxName === 'sbx-n')?.diskSize).toBeUndefined()
  store.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/store/db.test.ts`
Expected: FAIL — `diskSize` is not persisted (or a type error). (If it errors on the better-sqlite3 native ABI, that's the environment lock — see Global Constraints; proceed and rely on typecheck + the code review for this task.)

- [ ] **Step 3: Add the type fields**

In `src/shared/types.ts`, `InstanceMeta` (after `credFingerprint?`):

```ts
  /** Credential fingerprint captured at create time; used to flag credential drift (→ rebuild). Null for pre-v7 rows. */
  credFingerprint?: string | null
  /** Block-volume size the sandbox was created with (e.g. '20g'); undefined = Docker's 50 GB default / unknown. */
  diskSize?: string
```

In `InstanceView` (after `createdAt: string | null`):

```ts
  createdAt: string | null
  /** Disk size this instance was created with (from instance_meta); undefined when unknown. */
  diskSize?: string
```

- [ ] **Step 4: Column + migration + threading in `db.ts`**

(a) `instance_meta` CREATE TABLE (add after `cred_fingerprint TEXT,`, before the FOREIGN KEY line):

```sql
  cred_fingerprint TEXT,
  disk_size TEXT,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE SET NULL
```

(b) Bump the version (line ~118): `PRAGMA user_version = 13;`

(c) New migration block, immediately after the v11→v12 definition disk_size block (after line ~178). `imCols` is already computed earlier (the cred_fingerprint migration):

```ts
  // v12 → v13: instance_meta records the disk size each instance was created with, so a
  // rebuild can pre-fill it. Non-destructive; existing rows stay NULL → unknown (rebuild
  // falls back to the definition default).
  if (!imCols.includes('disk_size')) {
    db.exec(`ALTER TABLE instance_meta ADD COLUMN disk_size TEXT;`)
  }
```

(d) `upsertInstanceMeta` — add the column, the value, the ON CONFLICT clause, and the bound param:

```ts
    upsertInstanceMeta(m) {
      db.prepare(
        `INSERT INTO instance_meta (sbx_name, definition_id, created_by_app, created_at, cred_fingerprint, disk_size)
         VALUES (@sbxName, @definitionId, @createdByApp, @createdAt, @credFingerprint, @diskSize)
         ON CONFLICT(sbx_name) DO UPDATE SET
           definition_id = excluded.definition_id,
           created_by_app = excluded.created_by_app,
           created_at = excluded.created_at,
           cred_fingerprint = excluded.cred_fingerprint,
           disk_size = excluded.disk_size`
      ).run({ ...m, createdByApp: m.createdByApp ? 1 : 0, credFingerprint: m.credFingerprint ?? null, diskSize: m.diskSize ?? null })
    },
```

(e) `listInstanceMeta` — add to SELECT and map:

```ts
    listInstanceMeta() {
      const rows = db.prepare(`SELECT sbx_name AS sbxName, definition_id AS definitionId, created_by_app AS createdByApp, created_at AS createdAt, cred_fingerprint AS credFingerprint, disk_size AS diskSize FROM instance_meta`).all() as Array<Record<string, unknown>>
      return rows.map((r) => ({ sbxName: String(r.sbxName), definitionId: r.definitionId ? String(r.definitionId) : null, createdByApp: r.createdByApp === 1, createdAt: String(r.createdAt), credFingerprint: r.credFingerprint != null ? String(r.credFingerprint) : null, diskSize: r.diskSize != null ? String(r.diskSize) : undefined }))
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/main/store/db.test.ts` (if ABI-blocked, run `npm run typecheck` instead and note it).
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/store/db.ts tests/main/store/db.test.ts
git commit -m "$(cat <<'EOF'
feat(store): persist per-instance diskSize (instance_meta, migration v12->v13)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Record disk size at launch

**Files:**
- Modify: `src/main/launch.ts` (the `upsertInstanceMeta` call in `launchDefinition`)
- Test: `tests/main/launch.test.ts`

**Interfaces:**
- Consumes: `InstanceMeta.diskSize` (Task 1); the `disk` variable already resolved at `launch.ts:89`.
- Produces: every launch (fresh or rebuild) writes `diskSize` = the effective size onto the instance-meta row.

- [ ] **Step 1: Write the failing test**

Append to `tests/main/launch.test.ts` (uses the existing `spec` and `deps` helpers; `deps`'s mock store pushes to `metas`):

```ts
describe('launchDefinition records instance disk size', () => {
  it('persists the definition default disk size onto the instance meta', async () => {
    const d = deps(() => ({ ...spec, definition: { ...spec.definition, diskSize: '30g' } }))
    await launchDefinition(d as never, 'd1')
    expect(d.metas[0].diskSize).toBe('30g')
  })
  it('persists the override when one is passed', async () => {
    const d = deps(() => ({ ...spec, definition: { ...spec.definition, diskSize: '30g' } }))
    await launchDefinition(d as never, 'd1', undefined, undefined, 'terminal', [], '8g')
    expect(d.metas[0].diskSize).toBe('8g')
  })
  it('leaves diskSize undefined when neither is set', async () => {
    const d = deps(() => spec)
    await launchDefinition(d as never, 'd1')
    expect(d.metas[0].diskSize).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/launch.test.ts -t "records instance disk size"`
Expected: FAIL — `metas[0].diskSize` is `undefined` (not recorded). (This uses the mock store, so it runs under the ABI lock.)

- [ ] **Step 3: Record `diskSize` on the upsert**

In `src/main/launch.ts`, the `deps.store.upsertInstanceMeta({...})` call (lines ~94-102). Add `diskSize: disk` (the `disk` const is already in scope from line 89):

```ts
  deps.store.upsertInstanceMeta({
    sbxName: name,
    definitionId,
    createdByApp: true,
    createdAt: new Date().toISOString(),
    // Record the credential set baked into this sandbox so later credential changes to the
    // definition can be flagged as drift (→ needs rebuild). See reconcile().
    credFingerprint: credFingerprint(spec.credentials),
    // Record the disk size this sandbox was created with so a later rebuild can pre-fill it.
    diskSize: disk
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/launch.test.ts -t "records instance disk size"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/launch.ts tests/main/launch.test.ts
git commit -m "$(cat <<'EOF'
feat(launch): record the effective disk size onto instance metadata

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Surface diskSize on `InstanceView` via reconcile

**Files:**
- Modify: `src/main/reconciler.ts` (the `InstanceView` return object)
- Test: `tests/main/reconciler.test.ts`

**Interfaces:**
- Consumes: `InstanceMeta.diskSize` (Task 1), `InstanceView.diskSize` (Task 1).
- Produces: `reconcile(...)` returns each `InstanceView` with `diskSize` = its meta row's `diskSize` (undefined when there's no meta).

- [ ] **Step 1: Write the failing test**

Append to `tests/main/reconciler.test.ts`, following the file's existing store/adapter setup (mirror an existing test's fixture — seed an `instance_meta` row with a `diskSize`, then assert the reconciled view carries it):

```ts
it('carries the instance disk size onto the view', async () => {
  // Use the same store + adapter setup the other tests in this file use.
  store.upsertInstanceMeta({ sbxName: 'box', definitionId: null, createdByApp: true, createdAt: 't', diskSize: '25g' })
  const views = await reconcile(adapterWith(['box']), store) // match this file's reconcile(...) call shape
  expect(views.find((v) => v.name === 'box')?.diskSize).toBe('25g')
})
```

> Match the file's actual `reconcile(...)` invocation and adapter/store helpers — the assertion is the point: `view.diskSize` equals the meta's `diskSize`. If the file builds its store via `openStore`, this test is ABI-gated (see Global Constraints) — then rely on typecheck + review for this task.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/reconciler.test.ts -t "carries the instance disk size"`
Expected: FAIL — `view.diskSize` is `undefined`.

- [ ] **Step 3: Carry `diskSize` onto the view**

In `src/main/reconciler.ts`, the returned object (lines ~124-132). `meta` is already in scope:

```ts
    return {
      ...inst,
      definitionId: def?.id ?? null,
      definitionName: def?.name ?? null,
      tier: def?.tier ?? 'custom',
      credsDrift,
      tags: tagsByName.get(inst.name) ?? [],
      createdAt,
      diskSize: meta?.diskSize
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/reconciler.test.ts -t "carries the instance disk size"` (or `npm run typecheck` if ABI-gated).
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/reconciler.ts tests/main/reconciler.test.ts
git commit -m "$(cat <<'EOF'
feat(reconcile): surface instance diskSize on InstanceView

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Thread the override through `instance:rebuild`

**Files:**
- Modify: `src/main/ipc.ts` (`instance:rebuild` type ~131, impl ~270, registration ~511)
- Modify: `src/preload/index.ts:18` (`instanceRebuild`)
- Modify: `src/renderer/ipc/client.ts:19` (`instanceRebuild` interface)
- Test: `tests/main/ipc-tags.test.ts`

**Interfaces:**
- Consumes: `launchDefinition(…, diskSizeOverride?)` (already present from PR #13).
- Produces: `instanceRebuild(name, opener?, diskSize?: string)` end to end; the handler passes `diskSize` as the override to `launchDefinition`.

- [ ] **Step 1: Write the failing test**

Append to `tests/main/ipc-tags.test.ts` (reuse its `baseDeps`, capturing `openTerminal`):

```ts
describe('instance:rebuild disk size', () => {
  it('forwards the disk-size override into the rebuilt create step', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({
      definition: { id: 'd1', name: 'proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: new Date().toISOString() },
      mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    })
    const cmds: string[] = []
    const deps = {
      ...baseDeps(store),
      adapter: { ...baseDeps(store).adapter, removeSandbox: async () => {}, removeSecret: async () => {}, removeCustomSecret: async () => {}, removeRegistrySecret: async () => {} },
      openTerminal: (c: string) => cmds.push(c)
    }
    const h = buildHandlers(deps)
    const launched = await h['instance:launch']('d1', undefined, undefined, 'terminal', [])
    const name = launched.ok ? launched.data.name : ''
    await h['instance:rebuild'](name, 'terminal', '12g')
    expect(cmds[cmds.length - 1]).toContain("DOCKER_SANDBOXES_DOCKER_SIZE='12g' sbx create")
  })
})
```

> This constructs a real store → ABI-gated locally (see Global Constraints). If it can't run, `npm run typecheck` plus review is the compensating control; it runs in CI.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/ipc-tags.test.ts -t "instance:rebuild disk size"`
Expected: FAIL — the handler drops the arg, so no env var appears (or a type error).

- [ ] **Step 3: Thread `diskSize` through the layers**

In `src/main/ipc.ts`:

(a) Handler type (line ~131):

```ts
  'instance:rebuild': (name: string, opener?: 'terminal' | 'vscode', diskSize?: string) => Promise<Result<{ name: string }>>
```

(b) Handler impl (line ~270) — accept `diskSize` and pass it as the 7th arg to `launchDefinition`:

```ts
    'instance:rebuild': (name, opener, diskSize) => wrap(async () => {
      // Recreate the sandbox from its definition so config/credential changes (e.g. new
      // custom-secret env vars, only injected at create time) take effect. Removes the old
      // sandbox + its scoped secrets/.sandbox, then launches a fresh instance.
      const { definitionId } = await resolveInstanceDefinition(deps, name)
      if (!definitionId) throw new SbxError('not-found', `Instance "${name}" has no linked definition to rebuild from.`)
      const tags = deps.store.listInstanceTags().get(name) ?? []
      deps.log?.info(`Rebuilding instance "${name}" (recreate from definition ${definitionId} to apply current config/credentials).`)
      await cleanupInstance(deps, name)
      return launchDefinition(launchDeps(), definitionId, undefined, undefined, opener ?? 'terminal', tags, diskSize)
    }),
```

(c) Registration (line ~511):

```ts
  ipcMain.handle('instance:rebuild', (_e, name: string, opener?: 'terminal' | 'vscode', diskSize?: string) => handlers['instance:rebuild'](name, opener, diskSize))
```

In `src/preload/index.ts` (line 18):

```ts
  instanceRebuild: (name: string, opener?: 'terminal' | 'vscode', diskSize?: string) => ipcRenderer.invoke('instance:rebuild', name, opener, diskSize),
```

In `src/renderer/ipc/client.ts` (line 19):

```ts
  instanceRebuild(name: string, opener?: 'terminal' | 'vscode', diskSize?: string): Promise<Result<{ name: string }>>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/ipc-tags.test.ts -t "instance:rebuild disk size"` (or `npm run typecheck` if ABI-gated).
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc-tags.test.ts
git commit -m "$(cat <<'EOF'
feat(ipc): thread diskSize override through instance:rebuild

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `RebuildDialog` component + pre-fill helper

**Files:**
- Create: `src/renderer/components/RebuildDialog.tsx`
- Test: `tests/renderer/RebuildDialog.test.tsx` (new)

**Interfaces:**
- Consumes: `isValidDiskSize` (`@shared/resources`); `useT`; existing i18n keys.
- Produces:
  - `rebuildInitialDiskSize(instanceDiskSize?: string, definitionDiskSize?: string): string` — returns `instanceDiskSize ?? definitionDiskSize ?? ''`.
  - `RebuildDialog` component, props `{ name: string; initialDiskSize: string; onRebuild: (diskSize: string) => void; onCancel: () => void }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/RebuildDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RebuildDialog, rebuildInitialDiskSize } from '../../src/renderer/components/RebuildDialog'

describe('rebuildInitialDiskSize', () => {
  it('prefers the instance size, then the definition default, then blank', () => {
    expect(rebuildInitialDiskSize('20g', '10g')).toBe('20g')
    expect(rebuildInitialDiskSize(undefined, '10g')).toBe('10g')
    expect(rebuildInitialDiskSize(undefined, undefined)).toBe('')
  })
})

describe('RebuildDialog', () => {
  function setup(initialDiskSize = '20g') {
    const onRebuild = vi.fn(); const onCancel = vi.fn()
    render(<RebuildDialog name="box" initialDiskSize={initialDiskSize} onRebuild={onRebuild} onCancel={onCancel} />)
    return { onRebuild, onCancel }
  }
  it('pre-fills the disk field and rebuilds with it', () => {
    const { onRebuild } = setup('20g')
    expect(screen.getByLabelText('Disk size')).toHaveValue('20g')
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))
    expect(onRebuild).toHaveBeenCalledWith('20g')
  })
  it('lets the user change the size', () => {
    const { onRebuild } = setup('20g')
    fireEvent.change(screen.getByLabelText('Disk size'), { target: { value: '40g' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))
    expect(onRebuild).toHaveBeenCalledWith('40g')
  })
  it('disables Rebuild and shows an error on an invalid size, and keeps empty valid', () => {
    setup('')
    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeEnabled() // empty = Docker default
    fireEvent.change(screen.getByLabelText('Disk size'), { target: { value: '40gb' } })
    expect(screen.getByText(/binary size like/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeDisabled()
  })
  it('cancels', () => {
    const { onRebuild, onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onRebuild).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/RebuildDialog.test.tsx`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement `RebuildDialog.tsx`**

Create `src/renderer/components/RebuildDialog.tsx` (mirrors `LaunchDialog`'s modal + disk-size field):

```tsx
import { useState } from 'react'
import { useT } from '../i18n'
import { isValidDiskSize } from '@shared/resources'

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', margin: 'var(--space-4) 0 var(--space-2)' } as const

/** Pre-fill precedence for the rebuild disk-size field: the instance's created-with size,
 * else the definition's current default, else blank (= Docker default). */
export function rebuildInitialDiskSize(instanceDiskSize?: string, definitionDiskSize?: string): string {
  return instanceDiskSize ?? definitionDiskSize ?? ''
}

/**
 * Rebuild confirmation with an editable disk size. Rebuild is the only path that recreates
 * the sandbox's volume, so it's the only place an existing instance's disk size can change.
 */
export function RebuildDialog({ name, initialDiskSize, onRebuild, onCancel }: {
  name: string
  initialDiskSize: string
  onRebuild: (diskSize: string) => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const [diskSize, setDiskSize] = useState(initialDiskSize)
  const valid = isValidDiskSize(diskSize)

  function submit(): void {
    if (valid) onRebuild(diskSize.trim())
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('instances.rebuildTitle')} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{t('instances.rebuildTitle')}</h3>
        <p className="modal-desc">{t('instances.rebuildBody', { name })}</p>

        <label htmlFor="rebuild-disk-size" style={labelStyle}>{t('launch.diskSizeLabel')}</label>
        <input
          id="rebuild-disk-size"
          aria-label="Disk size"
          className="input"
          value={diskSize}
          placeholder={t('launch.diskSizePlaceholder')}
          autoFocus
          onChange={(e) => setDiskSize(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        {!valid && <p role="alert" className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0, color: 'var(--danger)' }}>{t('launch.diskSizeInvalid')}</p>}

        <div className="modal-actions" style={{ marginTop: 'var(--space-5)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>{t('instances.cancel')}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={submit}>{t('instances.confirmRebuild')}</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/RebuildDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/RebuildDialog.tsx tests/renderer/RebuildDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(rebuild): RebuildDialog with editable, pre-filled disk size

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire `RebuildDialog` into `App.tsx`

**Files:**
- Modify: `src/renderer/App.tsx`
- (No new test file — verified by typecheck + the Task 5 component/helper tests; App orchestration is thin.)

**Interfaces:**
- Consumes: `RebuildDialog`, `rebuildInitialDiskSize` (Task 5); `InstanceView.diskSize` (Tasks 1/3); `api.instanceRebuild(name, opener, diskSize)` (Task 4); `api.defGetSpec`.
- Produces: rebuild opens with a pre-filled disk-size dialog; the chosen size is passed to `api.instanceRebuild`.

- [ ] **Step 1: Extend the `pending` state to carry the pre-fill**

In `src/renderer/App.tsx`, the `pending` state (line ~37) gains an optional `initialDiskSize` used only by the rebuild case:

```ts
  const [pending, setPending] = useState<{ kind: 'stop' | 'remove' | 'rebuild'; name: string; initialDiskSize?: string } | null>(null)
```

- [ ] **Step 2: Make rebuild-open async and compute the pre-fill**

Replace the `onRebuild` wiring that currently does `setPending({ kind: 'rebuild', name })` (the prop passed to `InstanceDetail`, line ~242) with a call to a new async opener, and add the opener near `openLaunchDialog` (~line 132):

```tsx
// prop wiring (line ~242):
onRebuild={(name) => void openRebuildDialog(name)}
```

```ts
// new function, beside openLaunchDialog:
async function openRebuildDialog(name: string): Promise<void> {
  const inst = instances.find((i) => i.name === name)
  // Pre-fill with the instance's created-with size, else the definition's current default.
  let definitionDefault: string | undefined
  if (inst?.definitionId) {
    const specR = await api.defGetSpec(inst.definitionId)
    if (specR.ok && specR.data) definitionDefault = specR.data.definition.diskSize
  }
  setPending({ kind: 'rebuild', name, initialDiskSize: rebuildInitialDiskSize(inst?.diskSize, definitionDefault) })
}
```

Add the imports at the top of `App.tsx`:

```ts
import { RebuildDialog, rebuildInitialDiskSize } from './components/RebuildDialog'
```

- [ ] **Step 3: Render `RebuildDialog` for the rebuild case; drop rebuild from `ConfirmModal`**

Remove the `'rebuild'` branches from the shared `ConfirmModal` (the `pending?.kind === 'rebuild' ? …` ternaries in `title`/`body`/`confirmLabel`, lines ~260-269) so it only handles `stop`/`remove`, and gate that modal to non-rebuild:

```tsx
      <ConfirmModal
        open={pending !== null && pending.kind !== 'rebuild'}
        title={pending?.kind === 'stop' ? t('instances.stopTitle') : t('instances.removeTitle')}
        body={
          pending?.kind === 'stop'
            ? t('instances.stopBody', { name: pending.name })
            : t('instances.removeBody', { name: pending?.name ?? '' }) +
              (pending?.kind === 'remove' && hasSiblingInstances(instances, pending.name) ? ` ${t('instances.removeSharedWarning')}` : '')
        }
        confirmLabel={pending?.kind === 'stop' ? t('instances.confirmStop') : t('instances.confirmRemove')}
        cancelLabel={t('instances.cancel')}
        destructive={pending?.kind !== 'stop'}
        onConfirm={onConfirmPending}
        onCancel={() => setPending(null)}
      />
```

Then render `RebuildDialog` right after that modal:

```tsx
      {pending?.kind === 'rebuild' && (
        <RebuildDialog
          name={pending.name}
          initialDiskSize={pending.initialDiskSize ?? ''}
          onRebuild={(diskSize) => {
            const name = pending.name
            setPending(null)
            setDetailName(null) // rebuild makes the detail view stale (new instance name)
            void runAction(api.instanceRebuild(name, hasVSCode ? 'vscode' : 'terminal', diskSize))
          }}
          onCancel={() => setPending(null)}
        />
      )}
```

- [ ] **Step 4: Remove the now-dead rebuild branch from `onConfirmPending`**

In `onConfirmPending` (lines ~187-199), delete the `if (p.kind === 'rebuild') { … api.instanceRebuild(...) ; return }` block — rebuild no longer flows through `ConfirmModal`/`onConfirmPending` (it has its own dialog + handler above).

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: clean. Then `npx vitest run tests/renderer/RebuildDialog.test.tsx` still passes.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): rebuild dialog with pre-filled, editable disk size

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full verification

**Files:** none.

- [ ] **Step 1: Typecheck** — `npm run typecheck` → clean.
- [ ] **Step 2: Renderer + mock-store suites** — `npx vitest run tests/renderer tests/shared tests/main/launch.test.ts` → green (these don't need the native ABI).
- [ ] **Step 3: Full suite** — `npm test`. The `store/db`, `ipc-tags`, and `reconciler` disk-size cases run here if the better-sqlite3 node ABI is available (app closed / CI); otherwise they are ABI-gated per Global Constraints and covered by typecheck + review. The pre-existing unrelated `translate-copyfiles.test.ts` failure is not part of this feature.
- [ ] **Step 4: Finish** — use superpowers:finishing-a-development-branch.

---

## Self-Review

**Spec coverage:**
- Persist per-instance disk size (migration v12→v13) → Task 1. Record at launch → Task 2. Surface via `InstanceView`/reconcile → Task 3. Thread override through `instance:rebuild` → Task 4. `RebuildDialog` + pre-fill precedence → Task 5. App async open + render + drop from `ConfirmModal` → Task 6. Reuse i18n (no new keys) → Tasks 5/6 use existing keys. Testing per layer → each task + Task 7.

**Placeholder scan:** No TBD/TODO. The only deliberately deferred detail is matching `reconciler.test.ts`'s existing store/adapter fixture shape (Task 3 Step 1) — the assertion is fully specified; the harness call is left to match the file, because that fixture isn't reproduced here.

**Type consistency:** `diskSize?: string` on `InstanceMeta` and `InstanceView`; `instanceRebuild(name, opener?, diskSize?)` across preload/client/ipc (type + impl + registration); `launchDefinition(…, diskSizeOverride?)` 7th arg (existing); `rebuildInitialDiskSize(instanceDiskSize?, definitionDiskSize?)` and `RebuildDialog` props `{ name, initialDiskSize, onRebuild, onCancel }` match between Task 5 (definition) and Task 6 (use). The env-var assertion string `DOCKER_SANDBOXES_DOCKER_SIZE='<size>'` matches PR #13's injection.
