# Per-Step Auto-Save (Edit Wizard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the edit-definition wizard, auto-save the current draft whenever the user leaves a step (Next / Back / header-jump). Create mode is unchanged.

**Architecture:** Extract `submit()`'s persistence into a reusable `persist()` (gates → `defUpdate`/`defCreate` → stage creds, no navigation). A `go(step)` wrapper drives all navigation: create mode just dispatches; edit mode `await persist()` then dispatches (aborting on gate/IPC failure), with a "Saving…/Saved ✓" indicator. All in one file.

**Tech Stack:** React + TS renderer, Vitest + @testing-library/react.

## Global Constraints

- Run tests with **`npm test`** (the `pretest` hook flips the better-sqlite3 ABI). Never bare `vitest`. Also `npm run typecheck` and `npm run build`.
- i18n: `de: Dict` must match `en` keys (enforced by typecheck). Add every new key to BOTH `src/renderer/i18n/en.ts` and `de.ts`.
- Auto-save is **edit mode only** (`isEdit === (initial !== undefined)`). Create mode navigation must stay a plain `dispatch` with no persistence.
- Persistence is the WHOLE current draft via `api.defUpdate(toSpec(draft, initial.definition.id, initial.definition.createdAt))` + the existing credential-staging loop — identical to today's `submit()`, minus `onDone()`.
- Only `src/renderer/wizard/CreateDefinition.tsx`, the two i18n files, and `tests/renderer/wizard/CreateDefinition.test.tsx` change. No main/IPC/store changes.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Work on a branch off `main` (e.g. `feat/wizard-autosave`).

---

## File Structure

- `src/renderer/wizard/CreateDefinition.tsx` — extract `persist()`, add `go()` + `saveState`, rewire Next/Back/header, add the indicator.
- `src/renderer/i18n/en.ts`, `de.ts` — `wizard.saving`, `wizard.saved`.
- `tests/renderer/wizard/CreateDefinition.test.tsx` — new auto-save tests + adjust the two existing edit-mode tests + add `defUpdate` to the api mock.

---

## Task 1: Auto-save on leaving a step (edit mode)

**Files:**
- Modify: `src/renderer/wizard/CreateDefinition.tsx`
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Test: `tests/renderer/wizard/CreateDefinition.test.tsx`

**Interfaces:**
- Consumes: existing `api.defUpdate`, `api.defCreate`, `api.credStageValue`, `api.credStageFromEnv`; `toSpec`, `normalizeCommandsYaml`.
- Produces: `persist(): Promise<boolean>` and `go(step: number): void` inside the component; a `saveState` indicator; unchanged create-mode navigation.

- [ ] **Step 1: Add `defUpdate` to the test api mock**

The mock in `tests/renderer/wizard/CreateDefinition.test.tsx` currently lacks `defUpdate` (edit mode auto-save will call it). At the top, add a spy and include it in the mock:

```ts
const defUpdate = vi.fn()
```
Then in the `vi.mock('../../../src/renderer/ipc/client', () => ({ api: { … } }))` object, add:
```ts
    defUpdate: (s: unknown) => defUpdate(s),
```
And in `beforeEach`, reset it:
```ts
  defUpdate.mockReset(); defUpdate.mockResolvedValue({ ok: true, data: { id: 'd1' } })
```

- [ ] **Step 2: Write the failing tests**

Add to the `describe('CreateDefinition wizard', …)` block (reuse the existing `editSpec` fixture defined in that block):

```ts
  it('auto-saves the current draft when leaving a step in edit mode', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'edited desc' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 1 -> 2, auto-save
    await waitFor(() => expect(defUpdate).toHaveBeenCalled())
    expect(defUpdate.mock.calls[0][0].definition).toMatchObject({ id: 'd1', description: 'edited desc' })
    expect(await screen.findByText(/saved/i)).toBeInTheDocument()
  })

  it('does NOT auto-save on navigation in create mode', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 1 -> 2
    expect(defUpdate).not.toHaveBeenCalled()
    expect(defCreate).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/built-in templates/i)).toBeInTheDocument() // advanced to step 2
  })

  it('header-jump auto-saves in edit mode', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /ports/i })) // header jump to Ports
    await waitFor(() => expect(defUpdate).toHaveBeenCalled())
  })

  it('blocks navigation + auto-save when the Advanced kit YAML is unparseable (edit mode)', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /advanced/i })) // jump to Advanced (auto-saves current valid draft)
    await waitFor(() => expect(defUpdate).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Custom kit YAML'), { target: { value: 'commands: [oops' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i })) // try to leave Advanced
    expect(await screen.findByText(/kit YAML is invalid/i)).toBeInTheDocument()
    expect(defUpdate).toHaveBeenCalledTimes(1) // no second save; navigation aborted
  })
```

Run: `npm test -- CreateDefinition`
Expected: the new tests FAIL (no auto-save yet; e.g. `defUpdate` not called).

- [ ] **Step 3: Extract `persist()` from `submit()`**

Replace the existing `submit()` (the whole function) with a `persist()` + a thin `submit()`:

```ts
  // Persist the current draft (edit → defUpdate, create → defCreate) + stage entered
  // credential values. Runs the same gates as the final Save. Returns false (and shows an
  // inline error) on a gate/IPC failure; performs no navigation and never closes the wizard.
  async function persist(): Promise<boolean> {
    if (!draft.workspace.trim()) { dispatch({ type: 'goToStep', step: 1 }); setError(t('wizard.workspaceRequired')); return false }
    const kitCheck = normalizeCommandsYaml(draft.kitCommandsYaml)
    if (!kitCheck.ok) { dispatch({ type: 'goToStep', step: 6 }); setKitMsg({ kind: 'error', text: t('wizard.kitYamlInvalid', { message: kitCheck.error }) }); return false }
    const spec = initial
      ? toSpec(draft, initial.definition.id, initial.definition.createdAt)
      : toSpec(draft, createId(), now())
    const res = initial ? await api.defUpdate(spec) : await api.defCreate(spec)
    if (!res.ok) { setError(res.error.message); return false }
    for (const c of draft.credentials) {
      const sub = c.kind === 'service' ? `service:${c.serviceId}` : c.kind === 'registry' ? `registry:${c.id}` : `custom:${c.id}`
      const key = `${spec.definition.id}:${sub}`
      if (c.value.trim()) {
        const staged = await api.credStageValue(key, c.value)
        if (!staged.ok) { setError(t('wizard.stageFailed', { message: staged.error.message })); return false }
      } else if (c.kind === 'service' && c.fromEnv) {
        const staged = await api.credStageFromEnv(key, c.serviceId)
        if (!staged.ok) { setError(t('wizard.stageFailed', { message: staged.error.message })); return false }
      }
    }
    return true
  }

  async function submit(): Promise<void> {
    if (await persist()) onDone()
  }
```

- [ ] **Step 4: Add `saveState` + the `go()` navigation wrapper**

Add the state hook next to the others (after the `kitMsg` line):
```ts
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
```

Add `go()` (place it right after `persist()` / `submit()`):
```ts
  // Navigate between steps. In edit mode this auto-saves the current draft first and aborts
  // the move if saving fails a gate; in create mode it's a plain step change (persist only at
  // the final Create). Kept snappy: saving is a local IPC + SQLite write.
  async function go(step: number): Promise<void> {
    if (!isEdit) { dispatch({ type: 'goToStep', step }); return }
    setSaveState('saving')
    const ok = await persist()
    if (!ok) { setSaveState('idle'); return } // stay put; error already shown by persist()
    dispatch({ type: 'goToStep', step })
    setSaveState('saved')
  }
```

Reset the "saved" indicator to idle shortly after it shows. Add an effect (near the existing `useEffect`):
```ts
  useEffect(() => {
    if (saveState !== 'saved') return
    const id = setTimeout(() => setSaveState('idle'), 2000)
    return () => clearTimeout(id)
  }, [saveState])
```

- [ ] **Step 5: Rewire navigation to `go()`**

Header-jump button (the `isEdit ? <button …>` in the step header map): change its handler:
```ts
              <button key={n} type="button" className={`wizard-step ${cls}`} onClick={() => void go(n)}
                style={{ background: 'none', border: 'none', font: 'inherit', cursor: 'pointer' }}>
```

Footer Back + Next:
```tsx
          <button className="btn btn-ghost" onClick={() => void go(draft.step - 1)} disabled={draft.step === 1}>{t('common.back')}</button>
          {draft.step < TOTAL_STEPS ? (
            <button className="btn btn-primary" onClick={() => void go(draft.step + 1)} disabled={!canAdvance(draft)}>{t('common.next')}</button>
          ) : (
            <button className="btn btn-primary" onClick={() => void submit()} disabled={!draft.workspace.trim()} title={!draft.workspace.trim() ? t('wizard.workspaceRequired') : undefined}>{isEdit ? t('common.save') : t('common.createSandbox')}</button>
          )}
```

Add the save-state indicator inside `wizard-actions` (edit mode only), after the Next/Save button block, before `</div>`:
```tsx
          {isEdit && saveState !== 'idle' && (
            <span aria-live="polite" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
              {saveState === 'saving' ? t('wizard.saving') : t('wizard.saved')}
            </span>
          )}
```

- [ ] **Step 6: i18n keys**

`src/renderer/i18n/en.ts` (in `wizard`): add
```ts
    saving: 'Saving…',
    saved: 'Saved ✓',
```
`src/renderer/i18n/de.ts` (in `wizard`): add
```ts
    saving: 'Speichern…',
    saved: 'Gespeichert ✓',
```

- [ ] **Step 7: Adjust the existing edit-mode test that relied on navigating with an empty workspace**

The existing test `disables the create button and blocks submit when the working directory is cleared (edit mode)` clears the workspace on step 1 then header-jumps to Review. With auto-save, that jump now aborts (workspace gate) and keeps the user on step 1. Update it to assert the NEW behavior — the block happens on leaving the step:

```ts
  it('blocks navigation and does not save when the working directory is cleared (edit mode)', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i })) // attempt to leave step 1
    expect(await screen.findByText(/working directory is required/i)).toBeInTheDocument()
    expect(defUpdate).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/workspace/i)).toBeInTheDocument() // still on step 1
  })
```
(The error text comes from `t('wizard.workspaceRequired')` = "A working directory is required." — match a stable substring.)

Leave the create-mode walk-to-Review tests unchanged (they don't persist on navigation; `defUpdate`/`defCreate` stay uncalled until the final Create). If any other edit-mode test navigates and now trips on an unmocked call, ensure `defUpdate` resolves ok (Step 1 covers the mock).

- [ ] **Step 8: Run everything**

Run: `npm test -- CreateDefinition` → the new + adjusted tests PASS.
Run: `npm test` → full suite green. `npm run typecheck` → clean. `npm run build` → succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/wizard/CreateDefinition.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/wizard/CreateDefinition.test.tsx
git commit -m "feat(wizard): auto-save the draft on step change in edit mode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done criteria
- Editing a definition and moving between steps (Next/Back/header) persists via `defUpdate`, with a "Saving…/Saved ✓" indicator.
- An invalid draft (empty workspace / unparseable Advanced YAML) aborts the move and shows the inline error; nothing is persisted.
- Create mode navigation is unchanged (no persistence until the final Create).
- `npm test`, `npm run typecheck`, `npm run build` all green.
