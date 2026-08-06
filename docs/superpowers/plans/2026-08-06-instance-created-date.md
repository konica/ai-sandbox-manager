# Instance Created Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show when a sandbox instance was created, in the Instance Detail "Metadata" tab, as relative time ("Created 2 hours ago") with the absolute timestamp in a hover tooltip.

**Architecture:** Surface the already-stored `instance_meta.createdAt` on `InstanceView` via `reconcile()`, add a pure `formatRelativeTime` helper, and render a "Created" row in the existing `MetadataTab`. No new IPC or polling — the value rides along with the `instances:list` reconcile the detail view already consumes.

**Tech Stack:** TypeScript, React 18, Vitest (+ jsdom for renderer). `@shared`/`@main` path aliases.

## Global Constraints

- Run `npm run typecheck` (must be clean) and the SCOPED tests each task names. Do NOT run the full `npm test` — the machine's `better-sqlite3` is currently on the electron ABI (a running app holds it) and the node-ABI flip is blocked, so main-process suites can't run cleanly right now. Renderer tests (jsdom) and shared tests do NOT load `better-sqlite3` and run fine; main-process store/reconcile tests DO — run those with `npx vitest run <path>` only if they load without an ABI error, otherwise rely on typecheck + the scoped renderer/shared tests and note it in the report.
- `createdAt` is **nullable** (`string | null`): a true creation time only for app-launched instances; "first observed" for adopted/CLI instances; null when there's no metadata row. UI must handle null as "Unknown" and must not imply guaranteed precision.
- New user-facing strings go in BOTH `src/renderer/i18n/en.ts` and `de.ts`.
- Making `InstanceView.createdAt` required will cause a typecheck ripple in every test that builds an `InstanceView` literal — fix each by adding `createdAt: null` (Task 2), exactly as the `tags: []` ripple was handled before. Do NOT make the field optional to dodge it.

---

## File Structure

- **Create:** `src/shared/format-time.ts` — `formatRelativeTime`. Test: `tests/shared/format-time.test.ts`.
- **Modify:** `src/shared/types.ts` — add `createdAt: string | null` to `InstanceView`.
- **Modify:** `src/main/reconciler.ts` — thread the effective `createdAt` onto the returned view. Test: `tests/main/reconcile-created-at.test.ts` (new).
- **Modify:** `src/renderer/screens/detail/MetadataTab.tsx` — add `createdAt` prop + "Created" row. Test: `tests/renderer/detail/MetadataTab.test.tsx`.
- **Modify:** `src/renderer/screens/InstanceDetail.tsx` — pass `instance.createdAt` to `MetadataTab`.
- **Modify:** `src/renderer/i18n/en.ts`, `de.ts` — `detail.createdLabel`, `detail.createdUnknown`.
- **Modify (typecheck ripple):** every test file with an `InstanceView` literal — add `createdAt: null`.

---

## Task 1: `formatRelativeTime` shared helper (pure)

**Files:**
- Create: `src/shared/format-time.ts`
- Test: `tests/shared/format-time.test.ts`

**Interfaces:**
- Produces: `formatRelativeTime(iso: string | null, now?: number): string | null`

- [ ] **Step 1: Write the failing test**

Create `tests/shared/format-time.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../../src/shared/format-time'

const NOW = Date.parse('2026-08-06T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('formatRelativeTime', () => {
  it('returns null for null/empty/unparseable input', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull()
    expect(formatRelativeTime('', NOW)).toBeNull()
    expect(formatRelativeTime('not-a-date', NOW)).toBeNull()
  })
  it('"just now" under 60 seconds', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('just now')
    expect(formatRelativeTime(ago(59_000), NOW)).toBe('just now')
  })
  it('minutes with singular/plural', () => {
    expect(formatRelativeTime(ago(60_000), NOW)).toBe('1 minute ago')
    expect(formatRelativeTime(ago(5 * 60_000), NOW)).toBe('5 minutes ago')
  })
  it('hours with singular/plural', () => {
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe('1 hour ago')
    expect(formatRelativeTime(ago(3 * 60 * 60_000), NOW)).toBe('3 hours ago')
  })
  it('days with singular/plural', () => {
    expect(formatRelativeTime(ago(24 * 60 * 60_000), NOW)).toBe('1 day ago')
    expect(formatRelativeTime(ago(2 * 24 * 60 * 60_000), NOW)).toBe('2 days ago')
  })
  it('treats a future timestamp as "just now" (clock skew)', () => {
    expect(formatRelativeTime(new Date(NOW + 10_000).toISOString(), NOW)).toBe('just now')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/shared/format-time.test.ts`
Expected: FAIL — cannot find module `format-time`.

- [ ] **Step 3: Implement `src/shared/format-time.ts`**

```ts
/**
 * Human relative time for an ISO timestamp: "just now", "5 minutes ago", "3 hours ago",
 * "2 days ago". Returns null for null/empty/unparseable input so the caller renders its own
 * "unknown" text. Future timestamps (clock skew) are treated as "just now" — never negative.
 * `now` (ms) is injectable for deterministic tests; defaults to Date.now().
 */
export function formatRelativeTime(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const secs = Math.max(0, Math.floor((now - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/shared/format-time.test.ts`
Expected: PASS (all buckets, null cases, and future-timestamp case green).

- [ ] **Step 5: Commit**

```bash
git add src/shared/format-time.ts tests/shared/format-time.test.ts
git commit -m "feat(time): formatRelativeTime helper for human relative timestamps"
```

---

## Task 2: `InstanceView.createdAt` + reconciler threading

**Files:**
- Modify: `src/shared/types.ts` (`InstanceView`)
- Modify: `src/main/reconciler.ts` (`reconcile` — the per-instance map, ~L86-129)
- Test: `tests/main/reconcile-created-at.test.ts` (create)
- Modify (typecheck ripple): every test file that builds an `InstanceView` object literal — add `createdAt: null`.

**Interfaces:**
- Consumes: existing `instance_meta.createdAt` via the store.
- Produces: `InstanceView.createdAt: string | null` — the effective creation timestamp (existing meta value, or the value written on adoption in the same pass, else null).

- [ ] **Step 1: Add the field to `InstanceView`**

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
  /** ISO timestamp the app recorded (launch time; "first observed" for adopted/CLI instances;
   *  null when there is no metadata row). */
  createdAt: string | null
}
```

- [ ] **Step 2: Write the failing reconcile test**

Create `tests/main/reconcile-created-at.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reconcile } from '@main/reconciler'
import { openStore } from '@main/store/db'
import type { SbxInstance, DefinitionSpec } from '@shared/types'

function fakeAdapter(instances: SbxInstance[]) {
  return { listSandboxes: async () => instances } as never
}
const live = (name: string, workspace: string | null = null): SbxInstance =>
  ({ name, status: 'running', agent: 'claude', workspace, ports: [] })

describe('reconcile createdAt', () => {
  it('populates createdAt from an existing meta row', async () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'proj-a1', definitionId: null, createdByApp: true, createdAt: '2026-01-02T03:04:05.000Z', credFingerprint: null })
    const views = await reconcile(fakeAdapter([live('proj-a1')]), store)
    expect(views[0].createdAt).toBe('2026-01-02T03:04:05.000Z')
  })

  it('is null for an instance with no metadata row', async () => {
    const store = openStore(':memory:')
    const views = await reconcile(fakeAdapter([live('ghost-1')]), store)
    expect(views[0].createdAt).toBeNull()
  })

  it('is set immediately for a just-adopted workspace-linked instance', async () => {
    const store = openStore(':memory:')
    const spec: DefinitionSpec = {
      definition: { id: 'd1', name: 'Proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: '2026-01-01T00:00:00.000Z' },
      mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
      domains: [], ports: [], hostServices: [], credentials: []
    }
    store.insertDefinitionSpec(spec)
    // instance has no meta row yet, but its workspace matches the definition → adopted this pass
    const views = await reconcile(fakeAdapter([live('proj-cli', '/w')]), store)
    expect(views[0].definitionId).toBe('d1')     // adopted
    expect(views[0].createdAt).not.toBeNull()    // stamped in the same pass, not one poll later
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/main/reconcile-created-at.test.ts`
Expected: FAIL — `createdAt` is `undefined` (not on the view yet).

If this test errors on load with a `better-sqlite3` ABI/NODE_MODULE_VERSION mismatch (a running Electron app holds the module), note it and rely on `npm run typecheck` + the shared/renderer scoped tests for this task; the logic is small and typecheck-verified.

- [ ] **Step 4: Thread `createdAt` in `reconcile`**

In `src/main/reconciler.ts`, inside the `instances.map((inst) => { … })` block:

Right after `const meta = metaByName.get(inst.name) ?? null`, add:

```ts
    let createdAt: string | null = meta?.createdAt ?? null
```

Inside the adoption block, capture the value written to the store into that local. Change the adoption body from:

```ts
      if (adoptSpec) {
        store.upsertInstanceMeta({
          sbxName: inst.name,
          definitionId: def.id,
          createdByApp: meta?.createdByApp ?? false,
          createdAt: meta?.createdAt ?? new Date(nowMs).toISOString(),
          credFingerprint: credFingerprint(adoptSpec.credentials)
        })
      }
```

to:

```ts
      if (adoptSpec) {
        const adoptedCreatedAt = meta?.createdAt ?? new Date(nowMs).toISOString()
        createdAt = adoptedCreatedAt
        store.upsertInstanceMeta({
          sbxName: inst.name,
          definitionId: def.id,
          createdByApp: meta?.createdByApp ?? false,
          createdAt: adoptedCreatedAt,
          credFingerprint: credFingerprint(adoptSpec.credentials)
        })
      }
```

Add `createdAt` to the returned object:

```ts
    return {
      ...inst,
      definitionId: def?.id ?? null,
      definitionName: def?.name ?? null,
      tier: def?.tier ?? 'custom',
      credsDrift,
      tags: tagsByName.get(inst.name) ?? [],
      createdAt
    }
```

- [ ] **Step 5: Run the reconcile test to verify it passes**

Run: `npx vitest run tests/main/reconcile-created-at.test.ts`
Expected: PASS (populated from meta; null when none; set immediately on adoption).
(If blocked by the `better-sqlite3` ABI issue, skip this run and rely on typecheck — note it in the report.)

- [ ] **Step 6: Fix the typecheck ripple**

Run `npm run typecheck`. Making `createdAt` required breaks every `InstanceView` object literal that omits it (test helpers). Add `createdAt: null` to each such literal — the same set of files the `tags: []` ripple touched, e.g.:
- `tests/renderer/App.siblings.test.ts`
- `tests/renderer/InstanceDetail.test.tsx`
- `tests/renderer/Instances.test.tsx`
- `tests/renderer/Instances.actions.test.tsx`
- `tests/renderer/Instances.tags.test.tsx`
- `tests/renderer/detail/InstanceDetail.tags.test.tsx`
- `tests/renderer/detail/PortsTab.test.tsx`
- `tests/renderer/detail/TerminalsTab.test.tsx`
- `tests/renderer/App.launch.test.tsx` (the mocked `instancesList` data literal)

Add ONLY `createdAt: null` to each `InstanceView`-shaped literal (do not change assertions). Rerun `npm run typecheck` until clean. (Do not touch renderer component source here — only literals that fail typecheck.)

- [ ] **Step 7: Verify renderer suite still green (jsdom, no sqlite)**

Run: `npx vitest run tests/renderer`
Expected: PASS — the added `createdAt: null` literals don't change behavior.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/reconciler.ts tests/main/reconcile-created-at.test.ts tests/renderer
git commit -m "feat(reconciler): expose instance createdAt on InstanceView"
```

---

## Task 3: "Created" row in the Metadata tab

**Files:**
- Modify: `src/renderer/screens/detail/MetadataTab.tsx`
- Modify: `src/renderer/screens/InstanceDetail.tsx` (the `<MetadataTab … />` usage)
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Test: `tests/renderer/detail/MetadataTab.test.tsx`

**Interfaces:**
- Consumes: `formatRelativeTime` (Task 1), `InstanceView.createdAt` (Task 2).
- Produces: `MetadataTab({ tags, onChange, createdAt })` — renders a "Created" row above the Tags section.

- [ ] **Step 1: Add the i18n keys to both dicts**

In `src/renderer/i18n/en.ts`, inside the `detail: { … }` object (near the other `tags*` keys), add:

```ts
    createdLabel: 'Created',
    createdUnknown: 'Unknown',
```

In `src/renderer/i18n/de.ts`, inside its `detail` object, add:

```ts
    createdLabel: 'Erstellt',
    createdUnknown: 'Unbekannt',
```

- [ ] **Step 2: Update the MetadataTab test (new required prop + created-row behavior)**

Replace `tests/renderer/detail/MetadataTab.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetadataTab } from '../../../src/renderer/screens/detail/MetadataTab'

describe('MetadataTab', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z')) })
  afterEach(() => { vi.useRealTimers() })

  it('renders existing tags and calls onChange when a tag is added', () => {
    const onChange = vi.fn()
    render(<MetadataTab tags={['prod']} onChange={onChange} createdAt={null} />)
    expect(screen.getByText('prod')).toBeTruthy()
    const input = screen.getByLabelText('Edit instance tags')
    fireEvent.change(input, { target: { value: 'eu' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['prod', 'eu'])
  })

  it('shows relative created time with an absolute-time tooltip', () => {
    const threeHoursAgo = new Date('2026-08-06T09:00:00.000Z').toISOString()
    render(<MetadataTab tags={[]} onChange={vi.fn()} createdAt={threeHoursAgo} />)
    const el = screen.getByText('3 hours ago')
    expect(el.getAttribute('title')).toBe(new Date(threeHoursAgo).toLocaleString())
  })

  it('shows "Unknown" when createdAt is null', () => {
    render(<MetadataTab tags={[]} onChange={vi.fn()} createdAt={null} />)
    expect(screen.getByText('Unknown')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/renderer/detail/MetadataTab.test.tsx`
Expected: FAIL — `MetadataTab` doesn't accept `createdAt` / no "Created" row rendered.

- [ ] **Step 4: Implement the "Created" row in `MetadataTab.tsx`**

Rewrite `src/renderer/screens/detail/MetadataTab.tsx`:

```tsx
import { TagInput } from '../../components/TagInput'
import { useT } from '../../i18n'
import { formatRelativeTime } from '@shared/format-time'

/**
 * Metadata tab: per-instance metadata. Shows the created date (read-only) and the Tags editor
 * (organize/filter an instance). Presentational — the parent owns the tags state and persists
 * changes through onChange.
 */
export function MetadataTab({ tags, onChange, createdAt }: {
  tags: string[]
  onChange: (tags: string[]) => void
  createdAt: string | null
}): JSX.Element {
  const t = useT()
  const rel = formatRelativeTime(createdAt)
  return (
    <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 'var(--space-1)' }}>{t('detail.createdLabel')}</div>
        {rel && createdAt
          ? <span style={{ fontSize: 13, color: 'var(--text-secondary)' }} title={new Date(createdAt).toLocaleString()}>{rel}</span>
          : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('detail.createdUnknown')}</span>}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 'var(--space-2)' }}>{t('detail.tagsTitle')}</div>
        <TagInput
          tags={tags}
          onChange={onChange}
          placeholder={t('detail.tagsPlaceholder')}
          ariaLabel="Edit instance tags"
        />
        <p className="section-desc" style={{ fontSize: 11, margin: '6px 0 0' }}>{t('detail.tagsHint')}</p>
      </div>
    </div>
  )
}
```

Note: `@shared` is a resolved alias in both the app build and vitest config, so `import … from '@shared/format-time'` works in the component and its test.

- [ ] **Step 5: Pass `createdAt` from `InstanceDetail`**

In `src/renderer/screens/InstanceDetail.tsx`, update the `<MetadataTab … />` usage to pass the instance's timestamp:

```tsx
      {tab === 'metadata' && (
        <MetadataTab
          tags={tags}
          onChange={(next) => { setTags(next); onSetTags(instance.name, next) }}
          createdAt={instance.createdAt}
        />
      )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/detail/MetadataTab.test.tsx tests/renderer/detail/InstanceDetail.tags.test.tsx tests/renderer/InstanceDetail.test.tsx`
Expected: PASS. (`InstanceDetail.tags.test.tsx` already passes `createdAt: null` on its instance literal from Task 2's ripple, and it clicks the Metadata tab before editing — unaffected by the added created row.)

- [ ] **Step 7: Typecheck + full renderer suite**

Run: `npm run typecheck && npx vitest run tests/renderer`
Expected: typecheck clean; renderer suite green.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/screens/detail/MetadataTab.tsx src/renderer/screens/InstanceDetail.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/detail/MetadataTab.test.tsx
git commit -m "feat(ui): show instance created date in the Metadata tab"
```

---

## Self-Review

**Spec coverage:**
- `createdAt: string | null` on `InstanceView`, nullable/approximate handling → Task 2 (type) + Task 3 (UI "Unknown").
- Reconciler threads the effective timestamp, immediate on adoption → Task 2 Step 4 (local capture in the adoption branch).
- Relative time + absolute tooltip, dependency-free helper → Task 1 + Task 3 Step 4.
- Metadata tab only (no list column) → Task 3 (MetadataTab), no `Instances.tsx` change.
- i18n `createdLabel`/`createdUnknown` in both dicts → Task 3 Step 1.
- Tests: helper units, reconcile (meta/null/adoption), MetadataTab (set + tooltip + unknown) → all three tasks.
- Required-field ripple handled → Task 2 Step 6.

**Placeholder scan:** none — every step carries real code.

**Type consistency:** `formatRelativeTime(iso, now?)` signature identical across Task 1 (def) and Task 3 (use). `MetadataTab` props `{ tags, onChange, createdAt }` match the component (Task 3 Step 4), its test (Task 3 Step 2), and the `InstanceDetail` call site (Task 3 Step 5). `InstanceView.createdAt` added once (Task 2 Step 1) and consumed in Task 3 Step 5.
