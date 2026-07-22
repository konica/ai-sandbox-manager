# Per-Step Auto-Save in the Edit-Definition Wizard — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorming)

## Goal

When editing an existing sandbox definition, persist the user's changes as they
move through the wizard — each time they leave a step — instead of only at the
final Save. Creating a new definition is unchanged (persist once, at the end).

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Trigger | **Auto-save on leaving a step** — fires on Next, Back, and header-jump. No per-step Save button. |
| Applies to | **Edit mode only** (`initial` set). Create mode navigation stays pure (no persistence until the final Create). |
| What is persisted | The **whole current draft** via `api.defUpdate(toSpec(draft, id, createdAt))` (whole-spec transactional update) + staging any entered credential values — identical to today's `submit()` write, minus the close. |
| Invalid draft | Auto-save runs the same gates as `submit()` (workspace required, kit YAML parseable). On failure it **aborts the navigation**, stays on the step, and shows the inline error. |

## Why whole-draft (not per-field)

`updateDefinitionSpec` is a whole-spec transactional replace (deleteChildren +
insertChildren). In edit mode the draft is seeded from the complete existing spec
(`draftFromSpec`), so every field is populated; writing the whole draft on any
step is coherent and correct. Existing credential values are seeded blank and are
skipped by the staging loop (`if (c.value.trim())`), so auto-save never re-writes
untouched secrets — only values the user actually entered get staged.

## Architecture / components

All changes are in `src/renderer/wizard/CreateDefinition.tsx` (plus i18n + tests).
No main-process, IPC, or store changes — `api.defUpdate` / `api.credStageValue`
already exist.

### `persist(): Promise<boolean>` (extracted from `submit`)
Single persistence path, no navigation/close side effects:
1. Gate: `if (!draft.workspace.trim())` → `dispatch(goToStep 1)` + `setError(workspaceRequired)` → return `false`.
2. Gate: `normalizeCommandsYaml(draft.kitCommandsYaml)` fails → `dispatch(goToStep 6)` + `setKitMsg(error)` → return `false`.
3. Build spec: `toSpec(draft, initial ? initial.definition.id : createId(), initial ? initial.definition.createdAt : now())`.
4. `const res = initial ? await api.defUpdate(spec) : await api.defCreate(spec)`; on `!res.ok` → `setError` → return `false`.
5. Stage credential values (the existing loop); on stage failure → `setError` → return `false`.
6. return `true`.

`submit()` becomes: `if (await persist()) onDone()`.

### `go(step: number)` navigation wrapper
Replaces the raw `dispatch` calls behind Next / Back / header-jump:
- **Create mode** (`!isEdit`): `dispatch({ type: 'goToStep', step })` (unchanged behavior).
- **Edit mode**: `setSaveState('saving')` → `const ok = await persist()` → if `!ok` return (stay put; error already shown) → `dispatch({ type: 'goToStep', step })` → `setSaveState('saved')`.
- Wire: Next → `go(draft.step + 1)`, Back → `go(draft.step - 1)`, header buttons → `go(n)`. `canAdvance(draft)` still controls the Next button's `disabled` state as today.

### Save-state indicator
`const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')`.
Rendered in the wizard-actions footer, edit-mode only: "Saving…" while in flight,
"Saved ✓" after success (auto-reset to `idle` after ~2s via a `setTimeout` cleared
on unmount / next transition). Failure surfaces through the existing `error` /
`kitMsg` notices, not this indicator.

## Data flow
Edit wizard → user edits step fields (draft reducer) → clicks Next/Back/header →
`go()` → `persist()` (gates → `defUpdate` → stage creds) → on success navigate +
"Saved ✓"; on gate failure stay + inline error.

## Error handling
- Gate failures (workspace/kit): abort navigation, stay on the owning step, inline error (reuses existing `error` / `kitMsg`).
- `defUpdate` / staging IPC failure: `error` notice shown; navigation aborted (return `false`), so the user isn't misled into thinking it saved.
- Rapid navigation: `persist()` is awaited before `dispatch(goToStep)`, so writes can't overlap/race; local IPC + SQLite write latency is negligible.

## Testing
- **Auto-save on Next (edit):** render with `initial`, edit a field, click Next → `api.defUpdate` called with the updated spec; "Saved" indicator appears; target step renders.
- **No auto-save in create:** render without `initial`, click Next → `defUpdate`/`defCreate` NOT called; navigation still advances.
- **Invalid draft blocks nav + save (edit):** unparseable Advanced YAML, click Next → `defUpdate` not called, inline kit error shown, still on step 6.
- **Header-jump auto-saves (edit):** click a step header → `defUpdate` called, then the target step renders.
- **Final Save still persists + closes (edit):** Review step, Save → `persist` + `onDone()`.
- Adjust existing edit-mode wizard tests so the mocked `api.defUpdate` resolves `{ ok: true }`; create-mode walk-to-Review tests are unaffected (no persistence on navigation).

## Out of scope
- No per-step Save button (auto-save only).
- No create-mode persistence changes.
- No main/IPC/store changes.
