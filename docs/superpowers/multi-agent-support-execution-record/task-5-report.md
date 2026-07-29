# Task 5 report — persist `agent` in SQLite and migrate existing rows

## Status: DONE

## Files changed
- Modified: `src/main/store/db.ts`
  - `SCHEMA`: added `agent TEXT NOT NULL DEFAULT 'claude'` column to the `definition` CREATE TABLE (after `base_image`); bumped `PRAGMA user_version` from 9 to 10.
  - Added v8→v9 migration block immediately after the existing `kit_commands_yaml` (v7→v8) block, guarded by `if (!defCols.includes('agent'))`: `ALTER TABLE definition ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude'` followed by three `UPDATE ... WHERE base_image LIKE '%:<suffix>'` backfills for `opencode`, `codex`, `copilot`.
  - Threaded `agent` through all six read/write sites: `insertDefinition`, `listDefinitions`, `getDefinition`, `insertDefinitionSpec`, `updateDefinitionSpec`, `getDefinitionSpec`.
- Created: `tests/main/store/db-agent-migration.test.ts`
  - Test 1 (from brief): backfills `agent` from `base_image` suffix for pre-migration rows (`opencode` suffix → `'opencode'`, `claude-code` suffix → `'claude'`, custom image → `'claude'`).
  - Test 2 (added per task instructions, not in brief): idempotency across repeated `openStore` calls on the same file — opens once (runs migration + inserts a spec), then opens twice more and asserts no throw and the `agent` value is stable.

## TDD steps

### Step 1/2 — failing test, confirmed RED for the right reason
Ran `npm run typecheck && npx vitest run tests/main/store/` before any implementation changes.

`npm run typecheck` output:
```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit
```
(clean, as expected — Task 2 already fixed the fixtures)

`npx vitest run tests/main/store/` output (relevant failures):
```
 FAIL  tests/main/store/db-agent-migration.test.ts > agent column migration > backfills agent from the base_image suffix for pre-migration rows
AssertionError: expected undefined to be 'opencode'
 ❯ tests/main/store/db-agent-migration.test.ts:33:46
     33|     expect(store.getDefinition('d1')?.agent).toBe('opencode')

 FAIL  tests/main/store/db-agent-migration.test.ts > agent column migration > is idempotent across repeated opens of the same already-migrated database
AssertionError: expected [Function] to not throw an error but 'AssertionError: expected undefined to…' was thrown
 ❯ tests/main/store/db-agent-migration.test.ts:60:12

 FAIL  tests/main/store/definition-spec.test.ts > definition spec persistence > round-trips a full spec
AssertionError: expected { Object (definition, mounts, ...) } to deeply equal { Object (definition, mounts, ...) }
  Object {
    "definition": Object {
-     "agent": "claude",
      ...
 ❯ tests/main/store/definition-spec.test.ts:26:17

 FAIL  tests/main/store/definition-spec.test.ts > definition spec persistence > persists an empty-children spec
AssertionError: expected { Object (definition, mounts, ...) } to deeply equal { Object (definition, mounts, ...) }
  Object {
    "definition": Object {
-     "agent": "claude",
      ...
 ❯ tests/main/store/definition-spec.test.ts:54:43

 Test Files  2 failed | 6 passed (8)
      Tests  4 failed | 20 passed (24)
```

All 4 failures are exactly the expected ones: the new migration test fails because `getDefinition(...)?.agent` is `undefined` (no `agent` column/select yet), and the two `definition-spec.test.ts` round-trips fail because the returned object is missing the `agent` key the fixture expects. Confirmed RED for the right reason — no typos, no unrelated errors.

### Step 3 — implement
Applied the brief's exact SQL/code (schema column + version bump, migration block, and the six read/write sites) as diffed below.

```diff
 CREATE TABLE IF NOT EXISTS definition (
   id TEXT PRIMARY KEY,
   name TEXT NOT NULL,
   description TEXT NOT NULL DEFAULT '',
   base_image TEXT NOT NULL,
+  agent TEXT NOT NULL DEFAULT 'claude',
   tier TEXT NOT NULL,
   ...
 );
 ...
-PRAGMA user_version = 9;
+PRAGMA user_version = 10;
```

```diff
   if (!defCols.includes('kit_commands_yaml')) {
     db.exec(`ALTER TABLE definition ADD COLUMN kit_commands_yaml TEXT;`)
   }
+  // v8 → v9: definitions gain an agent keyword (multi-agent support). Non-destructive;
+  // backfill from base_image's known variant suffix so pre-existing rows keep the agent
+  // they were actually built for (unrecognized/custom images default to 'claude', which
+  // is what every definition ran as before this column existed).
+  if (!defCols.includes('agent')) {
+    db.exec(`ALTER TABLE definition ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude';`)
+    db.exec(`UPDATE definition SET agent = 'opencode' WHERE base_image LIKE '%:opencode';`)
+    db.exec(`UPDATE definition SET agent = 'codex' WHERE base_image LIKE '%:codex';`)
+    db.exec(`UPDATE definition SET agent = 'copilot' WHERE base_image LIKE '%:copilot';`)
+  }
```

And `agent` added to the column lists/params of `insertDefinition`, `listDefinitions`, `getDefinition`, `insertDefinitionSpec`, `updateDefinitionSpec`, `getDefinitionSpec` (see `git show 4b7eb8d` for the full diff).

### Step 4 — confirm GREEN

`npm run typecheck`:
```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit
```
Clean (zero errors).

`npx vitest run tests/main/store/`:
```
 ✓ tests/main/store/db-ports.test.ts (1 test) 111ms
 ✓ tests/main/store/db-prefs.test.ts (3 tests) 88ms
 ✓ tests/main/store/db-ssh.test.ts (3 tests) 110ms
 ✓ tests/main/store/db.test.ts (4 tests) 171ms
 ✓ tests/main/store/db-copyfiles.test.ts (3 tests) 106ms
 ✓ tests/main/store/definition-spec.test.ts (5 tests) 163ms
 ✓ tests/main/store/db-creds.test.ts (3 tests) 133ms
 ✓ tests/main/store/db-agent-migration.test.ts (2 tests) 287ms

 Test Files  8 passed (8)
      Tests  24 passed (24)
```

**Explicit confirmation:** Both `definition-spec.test.ts` `expect(got).toEqual(spec)` round-trips (lines 26 and 54) now PASS — they are included in the 5 passing tests in that file above.

**Explicit confirmation `draft.test.ts:149` is still RED (Task 6's, untouched by me):**
```
npx vitest run tests/renderer/wizard/draft.test.ts
 ❯ tests/renderer/wizard/draft.test.ts (22 tests | 1 failed) 96ms
   × toSpec > builds a DefinitionSpec with the workspace as the primary mount 46ms
     → expected { id: 'id1', name: 'alpha', …(5) } to deeply equal { id: 'id1', name: 'alpha', …(4) }
 ❯ tests/renderer/wizard/draft.test.ts:149:29
    149|     expect(spec.definition).toEqual({ id: 'id1', name: 'alpha', descri…

 Test Files  1 failed (1)
      Tests  1 failed | 21 passed (22)
```
The failure diff shows `toSpec` (in `src/renderer/wizard/draft.ts`, not touched by this task) now producing `agent: 'claude'` (from the Task 6 stub at line 208) which the test's expected object doesn't yet include — this is exactly the Task 6 scope, unaffected by my changes.

**Full suite** (`npx vitest run`, 300000ms timeout): `Test Files 1 failed | 84 passed (85)`, `Tests 1 failed | 476 passed (477)`. The single failure is the same `draft.test.ts:149` (Task 6). No other regressions.

## Migration edge-case analysis

1. **`...:claude-code-docker` / `...:claude-code-minimal` must not be accidentally matched by another pattern.**
   The backfill `UPDATE` statements use `LIKE '%:opencode'`, `LIKE '%:codex'`, `LIKE '%:copilot'` — each requires the base_image to literally *end* with that colon-prefixed suffix. `...:claude-code-docker` ends with `-docker`, not `:opencode`/`:codex`/`:copilot`, so none of the three UPDATEs touch it; it keeps the column's `DEFAULT 'claude'` value set by the `ALTER TABLE ADD COLUMN`. Verified directly: the migration test's `d2` row (`docker.io/docker/sandbox-templates:claude-code`) asserts `agent` is `'claude'` after migration, and this passed.

2. **A custom image ref (e.g. `my/registry/thing:v2`) must end up `'claude'`.**
   None of the three `LIKE` patterns match, so the row retains the value the `ALTER TABLE ADD COLUMN ... DEFAULT 'claude'` populated it with when the column was created. Verified directly: migration test's `d3` row (`my/custom:tag`) asserts `agent === 'claude'`, and this passed.

3. **`ADD COLUMN ... NOT NULL DEFAULT 'claude'` must not fail on a table with existing rows.**
   SQLite allows `ALTER TABLE ADD COLUMN` with `NOT NULL` as long as a non-NULL `DEFAULT` is a constant (not `CURRENT_TIME`/an expression referencing other columns) — exactly this case, since `'claude'` is a literal. Verified directly: the migration test pre-populates 3 rows via a raw `better-sqlite3` connection *before* `openStore` runs the migration, then calls `openStore` (which executes the `ALTER TABLE`) — no error was thrown and all three rows read back successfully.

4. **Migration must be idempotent — `openStore` runs the block on every open.**
   The guard is `if (!defCols.includes('agent'))`, evaluated from a fresh `PRAGMA table_info(definition)` read at the top of every `openStore` call. Once the column exists (after the first open), `defCols.includes('agent')` is `true` on every subsequent open, so the `ALTER TABLE`/backfill `UPDATE`s are skipped entirely — they never re-run, so there's no risk of a duplicate-column error or of a backfill re-stomping an `agent` value a later code path may have deliberately changed. I added a dedicated test (`is idempotent across repeated opens of the same already-migrated database`) that opens the same DB file three times in sequence (first open creates + migrates + inserts a row with `agent: 'claude'` via `insertDefinitionSpec`, wrapped in `expect(...).not.toThrow()` for opens two and three) and asserts the `agent` value stays `'claude'` throughout. This test passed.

## `npm run typecheck` output (final)
```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit
```
Zero errors.

## Commit
`4b7eb8d` — "feat: persist and migrate the definition agent column" (2 files changed, 89 insertions, 11 deletions: `src/main/store/db.ts`, `tests/main/store/db-agent-migration.test.ts`).

## Self-review findings
- Diff matches the brief's exact SQL/code verbatim (schema column placement, migration comment, backfill UPDATEs, and all six read/write site signatures) — no deviation.
- No import from `@shared/agents` was added (per instructions) — `db.ts`'s only import changes are none; `Definition`/`DefinitionSpec` types already covered `agent` via Task 2's type change, so no new type import was needed either.
- Did not touch `src/renderer/wizard/draft.ts:208` or `src/main/defio/bundle.ts:40` (Task 6/Task 8 stubs) — confirmed via `git diff` scope (only `db.ts` and the new test file were staged/committed) and via the `draft.test.ts` RED-stays-RED check above.
- Did not touch any Claude OAuth `/login` flow files.
- The new migration test uses `mkdtempSync(join(tmpdir(), 'sbx-db-'))` for a real on-disk DB file, not a path inside the repo, per instructions.
- Considered whether the `LIKE` patterns could have false-positive matches from wildcard characters in `%` — the three literal suffixes (`opencode`, `codex`, `copilot`) contain no `%` or `_` characters themselves, so no unintended wildcard behavior inside the match text.
- Considered whether `agent` column ordering in `SCHEMA` (placed right after `base_image`) affects anything — it doesn't, since all reads/writes use named columns (`SELECT ... AS ...`, `@named` params, or explicit positional lists that were updated to match), never `SELECT *` or positional-only INSERT without a column list.
