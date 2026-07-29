# Final fix wave — multi-agent-support

Branch `worktree-multi-agent-support`, base HEAD `ea63e2c` (feat: carry agent through
definition export/import, backfilling older bundles). One fix wave, one commit.

## FIX 1 — custom-image path still reproduced the original 500 bug

**Files:**
- `src/shared/agents.ts` — added `matchedAgentFromBaseImage(baseImage): AgentId | null`, which
  is the same suffix-match loop `agentFromBaseImage` used to run inline, but returns `null` on
  no match instead of folding into `'claude'`. `agentFromBaseImage` is now
  `matchedAgentFromBaseImage(baseImage) ?? 'claude'` — signature and behavior unchanged (pinned
  by the existing `tests/shared/agents.test.ts`, unmodified and still green).
- `src/renderer/wizard/draft.ts` — `draftReducer`'s `'setField'` case now special-cases
  `field === 'customImageRef'`: it calls `matchedAgentFromBaseImage(a.value)` and only overwrites
  `d.agent` when that returns non-null; otherwise `d.agent` is left untouched. `setImageChoice`
  (already correct — preserves `d.agent` when switching to `'custom'`) is unchanged.
- `src/renderer/wizard/CreateDefinition.tsx` — **no changes**. The Agent `<select>` for the
  custom-image branch (~line 305-310) was already unconditionally rendered and wired to
  `setAgent`, so "explicit picker for custom, fully overridable" was already satisfied; only the
  silent-wrong-default needed fixing.

**Repro (verified with a temporary throwaway test, `specToCreateArgs` from
`src/main/sbx/translate.ts`, deleted before commit — not part of the diff):**

- Before the fix (simulating the old `{ ...d, customImageRef: value }` behavior — agent stays at
  the `initialDraft` default `'claude'`):
  ```
  sbx create claude /w --name w --template docker.io/docker/sandbox-templates:opencode
  ```
  — byte-identical to the reported 500-causing command.
- After the fix (choose custom → type `docker.io/docker/sandbox-templates:opencode`, agent never
  touched by hand):
  ```
  sbx create opencode /w --name w --template docker.io/docker/sandbox-templates:opencode
  ```

**Anti-clobber verification** — `tests/renderer/wizard/draft.test.ts`, new
`describe('custom image ref auto-seeds the agent (anti-clobber)')`:
1. `:opencode` ref → `agent === 'opencode'`.
2. `:codex` ref → `agent === 'codex'`.
3. Set agent to `'copilot'` explicitly, then type an unrecognized ref (`my/registry/thing:v2`) →
   `agent` stays `'copilot'` (the anti-clobber case — a naive `agentFromBaseImage(ref) ?? ...`
   application would have reset it to `'claude'` on every keystroke of an unrecognized ref).
4. Type a `:opencode` ref (agent auto-seeds to `'opencode'`), then explicitly `setAgent('copilot')`,
   then an unrelated `setField('name', …)` → `agent` stays `'copilot'` (explicit override survives
   unrelated edits).

All four ran RED first (before the `setField` change — `customImageRef` typing left `d.agent` at
its previous value in every case, so tests 1–2 failed while 3–4 accidentally passed since nothing
touched `agent` at all), then GREEN after the reducer change.

Also added: `draftFromSpec` round-trip for a **custom** `baseImage` + **non-claude** agent
(`tests/renderer/wizard/draft.test.ts`, `it('draftFromSpec round-trips a custom baseImage paired
with a non-claude agent')`) — the existing coverage only exercised the built-in-variant case.

## FIX 2 — no-domain warning didn't cover the import path

**Shared-predicate refactor:**
- New file `src/shared/provider-domain.ts`:
  ```ts
  export function needsProviderDomainWarning(agent: AgentId, tier: Tier, domainCount: number): boolean {
    return AGENT_PROFILES[agent].domains.length === 0 && tier === 'locked' && domainCount === 0
  }
  ```
  Placed outside `agents.ts` deliberately: `src/shared/types.ts` already imports `AgentId` from
  `agents.ts`, so `agents.ts` importing `Tier` back from `types.ts` would be circular.
  `provider-domain.ts` sits one level up, importing from both with no cycle.
- `src/renderer/wizard/draft.ts` — `needsProviderDomainHint(d: Draft)` is now a thin wrapper:
  `return needsProviderDomainWarning(d.agent, d.tier, d.domains.length)`. Signature unchanged, so
  the existing `describe('needsProviderDomainHint', …)` suite and the JSX call site in
  `CreateDefinition.tsx` (~line 335) needed no edits and are unmodified/green.
- `src/main/ipc.ts` — `def:import` now calls the same `needsProviderDomainWarning` per imported
  definition, using the already-normalized `d.definition.agent` / `d.definition.tier` /
  `d.domains.length` from `parseImportBundle`. **Proof both callers use one implementation**: both
  `draft.ts` and `ipc.ts` import `needsProviderDomainWarning` from `@shared/provider-domain` and
  neither re-implements the three-clause condition (`grep -n "domains.length === 0"` finds it
  exactly once, in `provider-domain.ts`).

**Import warning surface (least-invasive extension, backward-compatible):**
- `def:import`'s handler collects `{ name, agent }` for every flagged definition, logs one
  `deps.log?.info('⚠ Imported definition "<name>" (agent: <label>) has no reachable network
  domains — …')` line per flagged definition (same `deps.log?.info` mechanism `def:import`
  already used for its summary line; no new Logger level exists — `Logger` only has
  `info/command/error` — so this follows the existing `⚠` prefix convention already used in
  `src/main/creds/register.ts`).
- Return shape extended with an **optional** `domainWarnings?: string[]` (names only) —
  `'def:import'` handler type in `buildHandlers`, `Api.defImport` in
  `src/renderer/ipc/client.ts`. Old callers that don't read the field are unaffected; the IPC
  bridge (`ipcMain.handle('def:import', …)`) is a generic passthrough and needed no change.
- `src/renderer/App.tsx`'s `onImportDefs` — the only renderer consumer — now appends
  `t('definitions.importedNoDomainWarning', { names })` to the flash text and switches the flash
  `kind` to `'error'` (the only two kinds the type supports are `'info' | 'error'`; `'error'` was
  chosen purely for visual emphasis — the import itself did **not** fail, it still succeeded and
  the message is additive to the success text) when `domainWarnings.length > 0`.
- New i18n key `definitions.importedNoDomainWarning` added to **both**
  `src/renderer/i18n/en.ts` and `src/renderer/i18n/de.ts` (genuine German, not a stub):
  - en: `'Warning: no reachable network domains for {names} — its agent ships none, the tier is
    locked, and no custom domains were set. Add a domain or widen the tier before launching.'`
  - de: `'Warnung: keine erreichbaren Netzwerk-Domains für {names} — der Agent liefert keine mit,
    die Stufe ist „locked“, und es wurden keine eigenen Domains gesetzt. Fügen Sie vor dem Start
    eine Domain hinzu oder wählen Sie eine offenere Stufe.'`
  - `tests/renderer/i18n.test.ts` (unmodified) already asserts en/de key parity and passed.

**Import does not abort:** the warning path only pushes to an array and logs; `insertDefinitionSpec`
runs unconditionally either way — proven by the new ipc tests still asserting the definition lands
in the store (`store.listDefinitions()` implicitly via `def:import` returning `imported` with the
name either way).

**Tests** (`tests/main/ipc.test.ts`, three new cases beside the existing `def:import` suite):
1. Importing an opencode/locked/no-domains bundle → `r.data.domainWarnings === ['NoDomainBox']`
   and a mocked `log.info` call contains both the name and "no reachable network domains".
2. Importing a claude bundle → `r.data.domainWarnings === undefined`.
3. Importing an opencode bundle that DOES carry a domain → `r.data.domainWarnings === undefined`.

All three ran RED before the `ipc.ts` change (no `domainWarnings` field existed at all — TS
compile error on `r.data.domainWarnings`, then runtime `undefined !== ['NoDomainBox']` once typed
as `any`), GREEN after.

New standalone predicate test: `tests/shared/provider-domain.test.ts` (4 cases: true for
opencode/locked/0-domains; false once a domain exists; false on balanced/open; false for claude).

## FIX 3 — misleading comments / stale claim

- `src/main/store/db.ts:144` — comment `// v8 → v9: …` → `// v9 → v10: …`, now agreeing with the
  actual `PRAGMA user_version` bump (9 → 10) enacted by `SCHEMA` at `db.ts:106`. No code change,
  comment only.
- `src/renderer/wizard/draft.ts:40-44` — rewrote the stale "only claude-code … is wired to
  actually launch at MVP" claim (no longer true — this branch is precisely what generalized
  launching to every `AGENT_PROFILES` entry) to:
  > "Built-in base image templates offered in the wizard. These mirror the variants Docker
  > publishes; every variant is wired to actually launch via its AGENT_PROFILES entry
  > (src/shared/agents.ts). Only Claude's per-agent CLI values (keyword, resumeArgs,
  > sessionNameArgs, domains) are verified against the real CLI — the other agents' values are
  > unverified placeholders (see the TODO comments on each profile in agents.ts) until confirmed."

## FIX 4 — test-coverage gaps

- `tests/renderer/wizard/draft.test.ts` — added `draftFromSpec` round-trip for a **custom**
  `baseImage` + **non-claude** (`codex`) agent (see FIX 1 section above for detail); asserts
  `imageChoice === 'custom'`, `customImageRef` preserved verbatim, `agent === 'codex'`, and that
  `toSpec` round-trips both `agent` and `baseImage` back out unchanged.
- `tests/main/defio/bundle.test.ts` — the `spec(id, name)` helper is now `spec(id, name, agent:
  AgentId = 'claude')`, so existing call sites (all omitting the third arg) are unaffected. Added
  `describe('non-claude agent full round trip', …)`: `buildExportBundle([spec('d1', 'Codex Box',
  'codex')], …)` → `JSON.stringify` → `parseImportBundle` → asserts `agent === 'codex'` and the
  name survives — proving the full export/import round trip for a non-claude agent without a
  second hardcoded helper.

## Explicitly untouched (per the won't-fix triage)

Verified none of the following were touched: the `Object.keys(VARIANT_AGENT) as
BuiltinVariant[]` cast, codex/copilot `sessionNameArgs: () => []` direct assertions, the
`agentAttachCommand` weak-but-labelled test, no-clobber migration test, `SbxInstance.agent` /
unifying the two `?? 'claude'` fallbacks in `ipc.ts`, the Claude OAuth `/login` flow, or any
`AGENT_PROFILES` placeholder VALUES / TODO comments.

## Verification

`npm run typecheck` — clean, zero errors:
```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit
```
(no output after the command echo = zero diagnostics)

Targeted new/changed test files, run before the full suite:
```
✓ tests/shared/provider-domain.test.ts (4 tests)
✓ tests/main/defio/bundle.test.ts (14 tests)
✓ tests/shared/agents.test.ts (8 tests)          — unmodified, still green (pins agentFromBaseImage)
✓ tests/main/store/db-agent-migration.test.ts (2 tests) — unmodified, still green (pinned per instructions)
✓ tests/main/ipc.test.ts (19 tests)
✓ tests/renderer/wizard/draft.test.ts (37 tests)
Test Files  6 passed (6) · Tests  84 passed (84)
```

Full suite:
```
Test Files  86 passed (86)
     Tests  504 passed (504)
  Duration  140.99s
```
(was 85 files / 491 tests before this wave; +1 file (`tests/shared/provider-domain.test.ts`), +13
tests: 4 in that new file, +1 in `bundle.test.ts`, +5 in `draft.test.ts`, +3 in `ipc.test.ts`.)

Claude regression tests: `tests/shared/agents.test.ts`, `tests/main/store/db-agent-migration.test.ts`,
and the pre-existing `needsProviderDomainHint`/`draftFromSpec`/`toSpec` suites in `draft.test.ts`
were **not edited** and all still pass — Claude behavior is unchanged (pure widening confirmed).

## Self-review findings

- Double-checked `src/renderer/wizard/CreateDefinition.tsx` needed **no** edits for FIX 1: the
  Agent `<select>` was already present and overridable for the custom-image branch; only the
  reducer's default-seeding logic was missing.
- Confirmed no second copy of the three-clause `needsProviderDomainWarning` condition exists
  anywhere in the diff (`grep -n "domains.length === 0"` → exactly one hit, in
  `src/shared/provider-domain.ts`).
- Confirmed `agentFromBaseImage`'s exported signature and behavior are byte-identical to before
  (still `(baseImage: string) => AgentId`, still defaults to `'claude'`) — verified by leaving
  `tests/shared/agents.test.ts` untouched and green.
- Confirmed the wizard warning and the import warning are both advisory: `canAdvance` was not
  touched (still only gates on step 1/2 fields), and `def:import` still calls
  `insertDefinitionSpec` unconditionally regardless of the warning.
- i18n: added `definitions.importedNoDomainWarning` to both `en.ts` and `de.ts` with a genuine
  German translation; `tests/renderer/i18n.test.ts` (key-parity check, unmodified) passed.
- Removed a throwaway repro test file (`tests/scratch-repro.test.ts`) used only to capture the
  exact before/after `sbx create …` command strings for this report — it is not part of the
  committed diff.

## Commit

See the commit created immediately after this report was written; SHA recorded in the final
summary returned to the caller.
