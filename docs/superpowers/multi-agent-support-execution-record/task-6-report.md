# Task 6 Report — Wizard UI: agent field in the draft + Create Definition screen

## Files changed

- `src/renderer/wizard/draft.ts` — imports `AgentId`/`BuiltinVariant`/`AGENT_PROFILES`/`VARIANT_AGENT`/`agentFromBaseImage` from `@shared/agents`; removed the locally-duplicated `BuiltinVariant` type (now re-exported from `@shared/agents`); added `agent: AgentId` to `Draft`; added `agent: 'claude'` to `initialDraft`; added `setAgent` to `DraftAction` and its reducer case; `setImageChoice` now derives `agent` via `VARIANT_AGENT[a.value]` (or leaves it untouched when switching to `custom`); `draftFromSpec` reads `spec.definition.agent ?? agentFromBaseImage(...)`; **`toSpec` now writes `agent: d.agent` instead of the hardcoded `agent: 'claude'` stub**; added new exported helper `needsProviderDomainHint(d: Draft): boolean`.
- `src/renderer/wizard/CreateDefinition.tsx` — new imports (`AgentId`, `AGENT_PROFILES`, `needsProviderDomainHint`); step 2 (Base Image) gained an agent selector (`<select id="agent-select">`) shown only when `imageChoice === 'custom'`, and a read-only `Agent: <label>` line via `section-desc` otherwise; step 3 (Network) gained an inline `section-desc` hint rendered when `needsProviderDomainHint(draft)` is true, naming the agent and telling the user to add their model provider's domain below.
- `src/renderer/i18n/en.ts` / `src/renderer/i18n/de.ts` — added `wizard.agentLabel` (`'Agent'` in both) and `wizard.noDomainAgentHint` (English: `"{agent} has no built-in network domains — add your model provider’s domain below, or the agent won’t be able to reach it."`; German: `"{agent} bringt keine eingebauten Netzwerk-Domains mit — fügen Sie unten die Domain Ihres Modellanbieters hinzu, sonst kann der Agent ihn nicht erreichen."`).
- `tests/renderer/wizard/draft.test.ts` — added `describe('agent selection', ...)` (5 tests, verbatim from the brief) and `describe('needsProviderDomainHint', ...)` (5 tests, covering true-case, domain-added, balanced tier, open tier, and claude). Also **fixed** the pre-existing `toSpec` test's `toEqual` at line ~149 to include `agent: 'claude'` — contrary to the brief's claim that Task 2 already added this, `grep -n "agent" tests/renderer/wizard/draft.test.ts` before this task showed only line 6 (`storedSpec`) had an `agent` field; the `toSpec` toEqual did not. This test was the actual RED test (confirmed by running it before any code changes — see below) and needed this addition to pass once `toSpec` stopped stubbing `agent: 'claude'` unconditionally.

## Stub removal — proof

```
$ grep -n "agent: 'claude'" src/renderer/wizard/draft.ts
78:  agent: 'claude',
```

Line 78 is `initialDraft.agent: 'claude'` (the correct default draft value, per the brief's own Step 3 snippet) — **not** the `toSpec` stub. The `toSpec` line now reads:

```
221:    definition: { id, name: effectiveName(d), description: d.description.trim(), agent: d.agent, baseImage: resolveBaseImage(d), tier: d.tier, createdAt },
```

The stub is gone.

## TDD: failing → passing

Before any implementation, running the existing suite showed the pre-existing RED test:

```
❯ tests/renderer/wizard/draft.test.ts (22 tests | 1 failed) 105ms
 × toSpec > builds a DefinitionSpec with the workspace as the primary mount
   → expected { id: 'id1', name: 'alpha', …(5) } to deeply equal { id: 'id1', name: 'alpha', …(4) }
   + "agent": "claude",
```

After adding the new test blocks (agent selection, needsProviderDomainHint) but before implementing `draft.ts`/`CreateDefinition.tsx`:

```
Test Files  1 failed (1)
     Tests  10 failed | 22 passed (32)
```

Failures were `TypeError: needsProviderDomainHint is not a function` and `expected undefined to be 'opencode'` / `'codex'` etc. — i.e. failing because `agent`/`setAgent`/`needsProviderDomainHint` did not exist yet, the correct reason.

After implementation:

```
$ npx vitest run tests/renderer/wizard/draft.test.ts
✓ tests/renderer/wizard/draft.test.ts (32 tests) 53ms
Test Files  1 passed (1)
     Tests  32 passed (32)
```

Scoped wizard run:

```
$ npx vitest run tests/renderer/wizard/
Test Files  9 passed (9)
     Tests  89 passed (89)
```

## typecheck

```
$ npm run typecheck
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit
```

Zero errors, clean exit.

## Full suite — zero failures

```
$ npm test
Test Files  85 passed (85)
     Tests  487 passed (487)
Duration  136.09s
```

## Self-review findings

- Confirmed the stub removal via grep (above) — this was the headline risk item and is verified.
- The brief claimed `draft.test.ts:149`'s `toEqual` already had `agent: 'claude'` from Task 2; it did not. I added it as part of this task since the full suite must be green — verified via a pre-change run that this was indeed the sole pre-existing failure, and that it failed for exactly the reason expected (missing `agent` key from the stubbed `toSpec`).
- `needsProviderDomainHint` is a hint only: it is not referenced by `canAdvance` and does not gate submission — confirmed by reading `canAdvance` (untouched) and by the CreateDefinition.test.tsx `walks to the review step and submits a spec via defCreate` test still passing unmodified.
- Did not touch `src/main/defio/bundle.ts` (Task 8's `agent: 'claude'` stub, line 40) or the Claude OAuth `/login` flow, per constraints.
- `BUILTIN_VARIANTS`/`VariantInfo` stayed in `draft.ts` as instructed; only the duplicate `BuiltinVariant` type alias was removed and re-exported from `@shared/agents`.
- Verified `AGENT_PROFILES.opencode.domains` is indeed `[]` in `src/shared/agents.ts`, matching the helper's precondition.
- i18n: added the same two keys to both `en.ts` and `de.ts`, both under the `wizard:` object, with a genuine German translation for the new hint (not left in English).
- No lint script exists in `package.json` (only `typecheck` and `test`), so no separate lint step was run.

## Commit

Committed with the brief's exact message:

```
feat: expose agent selection in the sandbox creation wizard
```

(See final commit SHA relayed by the parent agent from the `git commit` output.)
