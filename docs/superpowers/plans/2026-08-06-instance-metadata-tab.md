# Instance Metadata Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the instance Tags editor out of the always-visible Instance Detail header into a new "Metadata" tab, reclaiming vertical space.

**Architecture:** Extract the existing header Tags card into a new presentational `MetadataTab` component, add a fourth tab (`metadata`) to `InstanceDetail`, remove the header card, and render the tab content behind `tab === 'metadata'`. Tags state and persistence stay exactly as they are in `InstanceDetail`.

**Tech Stack:** React 18 + TS, Vitest + jsdom + @testing-library/react. Renderer-only change — no main-process code, so tests never touch `better-sqlite3`.

## Global Constraints

- Renderer-only. Run `npm run typecheck` (must be clean) and the SCOPED renderer tests below — do NOT run the full `npm test` (it would load `better-sqlite3` under the node ABI, which is currently on the electron ABI, and is slow).
- Tag storage/IPC/normalization and the LaunchDialog/Instances-screen tag UI are UNCHANGED. Only the editor's location in `InstanceDetail` moves.
- New user-facing string `detail.tabMetadata` must be added to BOTH `src/renderer/i18n/en.ts` ("Metadata") and `src/renderer/i18n/de.ts` ("Metadaten").
- Tag edits still persist via `onSetTags` → `api.instanceSetTags` → `loadInstances()` (unchanged).
- The `TagInput` field keeps `ariaLabel="Edit instance tags"` (an existing test depends on it).

---

## File Structure

- **Create:** `src/renderer/screens/detail/MetadataTab.tsx` — the Tags editor as a presentational tab (lives in `detail/` beside the other tab components).
- **Create:** `tests/renderer/detail/MetadataTab.test.tsx` — component test.
- **Modify:** `src/renderer/screens/InstanceDetail.tsx` — add `'metadata'` to `DetailTab`, add the tab button, remove the header Tags card, render the tab content. (NOTE: this file is in `screens/`, NOT `screens/detail/`; it imports the tab components via `./detail/…`.)
- **Modify:** `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts` — add `detail.tabMetadata`.
- **Modify:** `tests/renderer/detail/InstanceDetail.tags.test.tsx` — click the Metadata tab before editing.

---

## Task 1: Move the Tags editor into a Metadata tab

**Files:**
- Create: `src/renderer/screens/detail/MetadataTab.tsx`
- Create: `tests/renderer/detail/MetadataTab.test.tsx`
- Modify: `src/renderer/screens/InstanceDetail.tsx` (`DetailTab` type L11; header Tags card L126-135; tab bar L145-161; tab content region after L202; doc comment L22-27)
- Modify: `src/renderer/i18n/en.ts` (after `tabMonitoring` L279), `src/renderer/i18n/de.ts` (after `tabMonitoring` L281)
- Modify: `tests/renderer/detail/InstanceDetail.tags.test.tsx`

**Interfaces:**
- Produces: `MetadataTab({ tags: string[]; onChange: (tags: string[]) => void }): JSX.Element` — renders the Tags editor card (title, `TagInput`, hint), using `useT()` internally.
- `DetailTab` becomes `'terminals' | 'ports' | 'monitoring' | 'metadata'`.

- [ ] **Step 1: Write the failing MetadataTab test**

Create `tests/renderer/detail/MetadataTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetadataTab } from '../../../src/renderer/screens/detail/MetadataTab'

describe('MetadataTab', () => {
  it('renders existing tags and calls onChange when a tag is added', () => {
    const onChange = vi.fn()
    render(<MetadataTab tags={['prod']} onChange={onChange} />)
    expect(screen.getByText('prod')).toBeTruthy()
    const input = screen.getByLabelText('Edit instance tags')
    fireEvent.change(input, { target: { value: 'eu' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['prod', 'eu'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/detail/MetadataTab.test.tsx`
Expected: FAIL — cannot find module `MetadataTab`.

- [ ] **Step 3: Create `MetadataTab.tsx`**

```tsx
import { TagInput } from '../../components/TagInput'
import { useT } from '../../i18n'

/**
 * Metadata tab: per-instance metadata editing. Currently just Tags (organize/filter an
 * instance); the tab name leaves room for more metadata later. Presentational — the parent
 * owns the tags state and persists changes through onChange.
 */
export function MetadataTab({ tags, onChange }: {
  tags: string[]
  onChange: (tags: string[]) => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="card" style={{ padding: 'var(--space-4)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 'var(--space-2)' }}>{t('detail.tagsTitle')}</div>
      <TagInput
        tags={tags}
        onChange={onChange}
        placeholder={t('detail.tagsPlaceholder')}
        ariaLabel="Edit instance tags"
      />
      <p className="section-desc" style={{ fontSize: 11, margin: '6px 0 0' }}>{t('detail.tagsHint')}</p>
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/renderer/detail/MetadataTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the i18n key to both dicts**

In `src/renderer/i18n/en.ts`, immediately after the `tabMonitoring: 'Monitoring',` line:

```ts
    tabMetadata: 'Metadata',
```

In `src/renderer/i18n/de.ts`, immediately after the `tabMonitoring: 'Überwachung',` line:

```ts
    tabMetadata: 'Metadaten',
```

- [ ] **Step 6: Wire `InstanceDetail.tsx` — type, import, remove header card, add tab + content**

In `src/renderer/screens/detail/InstanceDetail.tsx`:

1. Add the import next to the other tab imports (after the `MonitoringTab` import). `InstanceDetail.tsx` is in `screens/` and the tabs are in `screens/detail/`, so the existing imports use `./detail/…` — match that:
```ts
import { MetadataTab } from './detail/MetadataTab'
```

2. Extend the type (L11):
```ts
export type DetailTab = 'terminals' | 'ports' | 'monitoring' | 'metadata'
```

3. **Remove** the header Tags card entirely — delete this whole block (currently L126-135):
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
Also remove the now-unused `TagInput` import at the top (`import { TagInput } from '../components/TagInput'`) — `MetadataTab` owns it now. (`npm run typecheck` will flag it if missed: unused import is a TS error under this project's config, or at least keep the file clean.)

4. Add the Metadata tab button — inside the `role="tablist"` div, immediately AFTER the Monitoring tab `</button>` (the one closing at L160) and before the tablist's closing `</div>` (L161):
```tsx
        <button role="tab" aria-selected={tab === 'metadata'} style={tabStyle(tab === 'metadata')} onClick={() => setTab('metadata')}>{t('detail.tabMetadata')}</button>
```

5. Add the tab content — immediately AFTER the `{tab === 'monitoring' && ( … )}` block (closes at L202), before the closing `</section>`:
```tsx
      {tab === 'metadata' && (
        <MetadataTab
          tags={tags}
          onChange={(next) => { setTags(next); onSetTags(instance.name, next) }}
        />
      )}
```

6. Update the component doc comment (L22-27) to say four tabs (Terminals / Ports / Monitoring / Metadata) instead of three. Keep it brief.

Leave the `tags` state (L49) and its resync `useEffect` (L50-55) exactly as-is — the Metadata tab reads them via props.

- [ ] **Step 7: Update the existing InstanceDetail tags test to open the tab first**

In `tests/renderer/detail/InstanceDetail.tags.test.tsx`, the editor now lives behind the Metadata tab (default tab is `terminals`), so click it before querying the field. Change the test body so the two lines after `render(...)` read:

```tsx
    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }))
    const tagInput = screen.getByLabelText('Edit instance tags')
    fireEvent.change(tagInput, { target: { value: 'eu' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    expect(onSetTags).toHaveBeenCalledWith('proj-a1', ['prod', 'eu'])
```

(Only add the `fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }))` line; the rest is unchanged. `screen` and `fireEvent` are already imported.)

- [ ] **Step 8: Typecheck + run all affected renderer tests**

Run:
```
npm run typecheck
npx vitest run tests/renderer/detail/MetadataTab.test.tsx tests/renderer/detail/InstanceDetail.tags.test.tsx tests/renderer/InstanceDetail.test.tsx
```
Expected: typecheck clean; all listed tests PASS. If a test in `InstanceDetail.test.tsx` breaks because it asserted on the removed header Tags card or a fixed tab count, adapt it minimally to the four-tab layout without changing unrelated intent. (No such assertion is expected — those tests exercise Terminals/Ports/Monitoring behavior and header actions.)

- [ ] **Step 9: Commit**

```bash
git add src/renderer/screens/detail/MetadataTab.tsx src/renderer/screens/detail/InstanceDetail.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/detail/MetadataTab.test.tsx tests/renderer/detail/InstanceDetail.tags.test.tsx
git commit -m "feat(ui): move instance Tags editor into a new Metadata detail tab"
```

---

## Self-Review

**Spec coverage:**
- New Metadata tab holding the Tags editor → Steps 3, 6 (tab button + content).
- Tags fully removed from the header → Step 6.3 (delete the header card).
- Tab order Terminals · Ports · Monitoring · Metadata → Step 6.4 (button appended after Monitoring).
- Unchanged data flow / persistence → `onChange` still `setTags` + `onSetTags`; `tags` state + resync effect untouched.
- i18n `detail.tabMetadata` in both dicts → Step 5.
- Tests: new MetadataTab test + updated end-to-end tags test → Steps 1, 7.

**Placeholder scan:** none — all steps carry real code.

**Type consistency:** `MetadataTab` props `{ tags, onChange }` match both the component definition (Step 3) and its two call sites (the test in Step 1 and the `InstanceDetail` usage in Step 6.5). `DetailTab` union extended once (Step 6.2) and used by the new tab button/content.
