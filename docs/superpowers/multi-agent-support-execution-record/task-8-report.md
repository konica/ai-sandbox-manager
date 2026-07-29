# Task 8 Report — carry `agent` through definition export/import

## Files changed

- `src/main/defio/bundle.ts` — added imports (`AGENT_PROFILES`, `agentFromBaseImage` from `@shared/agents`; `AgentId` type), added `normalizeAgent(raw, baseImage): AgentId` helper, replaced the stub `agent: 'claude'` in `normalizeEntry` with `agent: normalizeAgent(def.agent, def.baseImage)`.
- `tests/main/defio/bundle.test.ts` — added a new `describe('normalizeEntry agent backfill', ...)` block with 4 cases:
  1. backfills agent from baseImage for an older bundle missing `agent` (expects `'opencode'` from `...:opencode` image suffix)
  2. preserves an explicit valid agent (`'codex'`) from a newer bundle
  3. rejects an unrecognized string (`"bogus"`) and falls back to the baseImage-derived agent (`'opencode'`)
  4. rejects a non-string value (`42`) and falls back to the baseImage-derived agent (`'opencode'`)

No other files were touched (scope was limited to `src/main/defio/bundle.ts` and `tests/main/defio/bundle.test.ts`, per instructions).

## Stub removal proof

```
$ grep -n "agent: 'claude'" src/main/defio/bundle.ts
$ echo "---grep exit: $?---"
---grep exit: 1---
```
No output; grep exit code 1 confirms no match. The stub is gone.

## Export path verification

`buildExportBundle` was read before and after the change — it is unmodified:

```ts
export function buildExportBundle(specs: DefinitionSpec[], now: string): DefinitionBundle {
  return {
    formatVersion: '1',
    kind: 'sandbox-definitions',
    exportedAt: now,
    definitions: specs.map((s) => {
      const { id: _id, createdAt: _createdAt, ...definition } = s.definition
      return { ...s, definition }
    })
  }
}
```

It spreads `s.definition` minus `id`/`createdAt` into the exported entry. Since `Definition.agent` is a required field on every in-memory `DefinitionSpec`, it is included in that spread automatically — no code change was needed here, confirmed by `git diff` showing zero changes to this function.

## TDD: failing → passing

**Failing run** (before implementing `normalizeAgent`, with stub still `agent: 'claude'`):
```
FAIL  tests/main/defio/bundle.test.ts > normalizeEntry agent backfill > backfills agent from baseImage when importing an older bundle that predates the field
  AssertionError: expected 'claude' to be 'opencode'
FAIL  tests/main/defio/bundle.test.ts > normalizeEntry agent backfill > preserves an explicit agent from a newer bundle
  AssertionError: expected 'claude' to be 'codex'
FAIL  tests/main/defio/bundle.test.ts > normalizeEntry agent backfill > rejects an unrecognized agent string and falls back to baseImage-derived agent
  AssertionError: expected 'claude' to be 'opencode'
FAIL  tests/main/defio/bundle.test.ts > normalizeEntry agent backfill > rejects a non-string agent value and falls back to baseImage-derived agent
  AssertionError: expected 'claude' to be 'opencode'

Test Files  1 failed (1)
     Tests  4 failed | 9 passed (13)
```
All 4 failed for the expected reason: the hardcoded stub always returned `'claude'`.

**Passing run** (after implementing `normalizeAgent` and wiring it into `normalizeEntry`):
```
 ✓ tests/main/defio/bundle.test.ts (13 tests) 35ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
```

## `npm run typecheck`

```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit
```
Clean exit, zero errors/output.

## Full suite

```
 Test Files  85 passed (85)
      Tests  491 passed (491)
   Start at  07:44:06
   Duration  136.17s
```
85/85 files, 491/491 tests, zero failures (487 baseline + 4 new = 491). All green.

## Commit

```
ea63e2c6e5d46776271dc7a69b2027ed3f30b491 feat: carry agent through definition export/import, backfilling older bundles
 2 files changed, 59 insertions(+), 1 deletion(-)
```

## Self-review findings

- `normalizeAgent` keys strictly off `AGENT_PROFILES` via `Object.prototype.hasOwnProperty.call`, so there is no second copy of the valid-agent list to drift out of sync with `src/shared/agents.ts`.
- No blind `as AgentId` cast reaches `def.agent` directly — the raw value is validated by `typeof` + membership check before any cast, and any invalid/missing value routes through `agentFromBaseImage`, which itself has a safe `'claude'` default.
- Verified `tests/main/ipc.test.ts:117`'s no-`agent` fixture was NOT touched (out of scope; only `tests/main/defio/bundle.test.ts` was modified) — its correctness now depends transitively on this same `normalizeEntry`/`normalizeAgent` path, which is exercised directly by the new bundle tests.
- Verified `tests/main/defio/bundle.test.ts:6`'s existing fixture (`agent: 'claude'` from Task 2) was left untouched, per instructions — no fixture fields were re-added or altered.
- No other files in the repo reference the stub string; scope was respected (only `src/main/defio/bundle.ts` and its test file were modified).
