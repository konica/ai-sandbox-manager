# Task 1 Report: Agent registry (`src/shared/agents.ts`)

## Status: DONE

## Commit
`75fc09fceb993ec15351491e79f2de20dae1fdb7` — "feat: add per-agent profile registry (claude/opencode/codex/copilot)"

## Files created
- `/c/Data/Projects/ai-sandbox-manager/.claude/worktrees/multi-agent-support/src/shared/agents.ts`
- `/c/Data/Projects/ai-sandbox-manager/.claude/worktrees/multi-agent-support/tests/shared/agents.test.ts`

Both files were transcribed verbatim from the brief (`.superpowers/sdd/2026-07-28-multi-agent-support/task-1-brief.md`), with no modification to existing files. Confirmed via `git status --short` before commit that only these two files were untracked/changed.

Exports from `src/shared/agents.ts`: `AgentId`, `BuiltinVariant`, `AgentProfile` (interface), `AGENT_PROFILES: Record<AgentId, AgentProfile>`, `VARIANT_AGENT: Record<BuiltinVariant, AgentId>`, `agentFromBaseImage(baseImage: string): AgentId`.

## Step 2: failing-test run (before implementation existed)

Command: `npx vitest run tests/shared/agents.test.ts`

```
 RUN  v2.1.9 /c/Data/Projects/ai-sandbox-manager/.claude/worktrees/multi-agent-support

 ❯ tests/shared/agents.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/shared/agents.test.ts [ tests/shared/agents.test.ts ]
Error: Cannot find module '@shared/agents' imported from '/c/Data/Projects/ai-sandbox-manager/.claude/worktrees/multi-agent-support/tests/shared/agents.test.ts'.

- If you rely on tsconfig.json's "paths" to resolve modules, please install "vite-tsconfig-paths" plugin to handle module resolution.
- Make sure you don't have relative aliases in your Vitest config. Use absolute paths instead. Read more: https://vitest.dev/guide/common-errors
 ❯ tests/shared/agents.test.ts:2:31
      1| import { describe, it, expect } from 'vitest'
      2| import { AGENT_PROFILES, VARIANT_AGENT, agentFromBaseImage } from '@sh…
       |                               ^
      3| import type { AgentId, BuiltinVariant } from '@shared/agents'
      4|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
   Start at  05:19:15
   Duration  6.85s (transform 218ms, setup 1.60s, collect 0ms, tests 0ms, environment 1ms, prepare 1.08s)
```

This is exactly the expected failure mode ("Cannot find module '@shared/agents'") — confirms the test was exercising the not-yet-created module, not failing for an unrelated reason (e.g. a typo, a broken vitest config, etc).

## Step 4: passing-test run (after implementation)

Command: `npx vitest run tests/shared/agents.test.ts`

```
 RUN  v2.1.9 /c/Data/Projects/ai-sandbox-manager/.claude/worktrees/multi-agent-support

 ✓ tests/shared/agents.test.ts (8 tests) 33ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  05:19:45
   Duration  7.33s (transform 286ms, setup 2.21s, collect 130ms, tests 33ms, environment 1ms, prepare 958ms)
```

All 8 test cases green:
- `AGENT_PROFILES`: has a profile for every agent with non-empty keyword/resumeArgs; carries verified Claude values; opencode ships with no hardcoded domains.
- `VARIANT_AGENT`: maps every BuiltinVariant to an AgentId; maps all three claude-code variants to claude.
- `agentFromBaseImage`: matches a known variant suffix; does not let claude-code-docker/-minimal collide with the bare claude-code suffix check; defaults to claude for unrecognized/custom/empty ref.

## Typecheck

Command: `npm run typecheck` → `tsc --noEmit`

Output: clean, no errors (only the npm script header line printed).

## Full suite (regression check)

Command: `npm test` (background-safe, ~131s)

Result: **84 files / 462 tests, all passing** (0 failed). Baseline before this task was 83 files / 454 tests — the delta is exactly the new file (+1 file, +8 tests), confirming no existing test was touched or broken.

## Self-review findings

1. **Byte-for-byte diff against the brief.** Ran `diff` between the brief's code block (lines 78–161, the `src/shared/agents.ts` block minus its leading `// src/shared/agents.ts` header comment) and the file I wrote — zero differences other than that one header line the brief uses to label the fence, which is not part of the file content. Same manual check for the test file (visual comparison during Write, since the test block already had no such header line). Confirms transcription was exact: domain lists, flag arrays, comment text, and TODO markers all match verbatim.
2. **TODO-comment constraint satisfied.** Verified each non-claude `AgentProfile` carries an inline `// TODO: verify against <agent> CLI` comment — opencode has `// TODO: verify against the opencode CLI. ...`, codex has `// TODO: verify against the Codex CLI.`, copilot has `// TODO: verify against the Copilot CLI.`. Claude's entry has no TODO and only the "Verified via the Phase 0 spike" comment on `CLAUDE_DOMAINS`, matching the constraint that Claude's values are presented as verified and the others are not.
3. **Scope discipline.** `git status --short` before committing showed only the two new files as untracked, nothing else modified. No edits to `src/shared/types.ts`, `translate.ts`, `draft.ts`, `generate.ts`, or the OAuth `/login` flow (`loginCommand`, `buildLoginKit`, `OAUTH_LOGIN_DOMAINS`) — none of those files were opened for writing at all, only referenced in the brief as out-of-scope/context.
4. **Duplicate `BuiltinVariant`.** Confirmed `src/renderer/wizard/draft.ts` still independently declares its own `BuiltinVariant` type (left untouched, per instructions — Task 6 is expected to remove that duplicate later). This is an intentional, temporary duplication and not a bug in this task.
5. **`agentFromBaseImage` suffix-matching logic double-checked.** The brief's implementation iterates `Object.keys(VARIANT_AGENT)` (order: `claude-code`, `claude-code-docker`, `claude-code-minimal`, `opencode`, `codex`, `copilot`) and does `baseImage.endsWith(':' + variant)`. I verified by hand that this does NOT have a collision bug regardless of iteration order: `'...:claude-code-docker'.endsWith(':claude-code')` is `false` because `endsWith` requires the *entire* trailing substring to match — `'-docker'` at the end doesn't match `'code'` at the end of `':claude-code'`. So the "does not let claude-code-docker/-minimal collide" test in the brief is really guarding against a naive `.includes()`-based check, not an actual bug in the given `.endsWith()` implementation. I did not change the logic (transcription only), just confirmed it already satisfies the test for the right reason.
6. No ESLint config exists in this repo (`.eslintrc*`/`eslint.config.*` absent, no `lint` script in `package.json`), so no lint step was run/needed.

## Anything surprising or judgment calls

- Nothing needed judgment — the brief was fully prescriptive (exact file contents for both implementation and test), so this task was pure transcription plus verification, as instructed. The only interpretive step was satisfying myself (point 5 above) that the suffix-matching algorithm was correct as given rather than just trusting it blindly, since Object.keys() iteration order matters in principle for prefix-collision bugs — it turned out to be fine because `endsWith` is a full-suffix match, not a substring/prefix check.
- The final full-suite run took ~131s (matches the ~132s estimate in the task instructions), comfortably under the 300000ms timeout I passed.
