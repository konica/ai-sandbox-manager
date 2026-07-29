# Task 4 Report — per-agent network domains in `kit/generate.ts`

## Status: DONE_WITH_CONCERNS

## Commit
`7fa579084261b28371ad25bff1eeca75d517dcbe`
"feat: derive kit network allowlist from the definition's agent"

## Files changed
- `src/main/kit/generate.ts` — deleted `CLAUDE_AGENT_DOMAINS` constant + its 2-line comment (old lines ~14-19); added `import { AGENT_PROFILES } from '@shared/agents'`; `allowedDomains` now reads `AGENT_PROFILES[spec.definition.agent].domains` instead of the deleted constant.
- `tests/main/kit/generate.test.ts` — `spec()` helper gained an `agent` parameter (default `'claude'`); the Claude-baseline test renamed to be explicit about the agent under test and now passes `'claude'` explicitly; added two new cases: opencode definitions must NOT get Claude domains, codex definitions must get `api.openai.com`.
- `src/shared/agents.ts` — only the comment above `CLAUDE_DOMAINS` was changed (no values touched), replacing the reference to the now-deleted `CLAUDE_AGENT_DOMAINS` symbol with a description of the `buildLoginKit`/`OAUTH_LOGIN_DOMAINS` relationship.
- `buildLoginKit` and `OAUTH_LOGIN_DOMAINS` in `generate.ts`: untouched, confirmed via diff.
- `tests/main/kit/write.test.ts`: not touched (per brief, needed no change).

## Step 2 — failing run (before implementation)
```
npx vitest run tests/main/kit/generate.test.ts

 ❯ tests/main/kit/generate.test.ts (12 tests | 2 failed) 88ms
   × buildKitSpec > does not allowlist the Claude domains for an opencode-agent definition
     → expected '...' not to contain 'api.anthropic.com'
   × buildKitSpec > allowlists the Codex domains for a codex-agent definition
     → expected '...' to contain 'api.openai.com'

 Test Files  1 failed (1)
      Tests  2 failed | 10 passed (12)
```
Both failures were for the expected reason: `allowedDomains` was still unconditionally splicing in the hardcoded `CLAUDE_AGENT_DOMAINS` regardless of `spec.definition.agent`, so opencode got Claude domains it shouldn't, and codex never got its own domains.

## Step 4 — passing run (after implementation)

`npm run typecheck`:
```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit
```
Exit 0, zero errors.

`npx vitest run tests/main/kit/`:
```
 ✓ tests/main/kit/write.test.ts (2 tests) 18ms
 ✓ tests/main/kit/generate.test.ts (12 tests) 50ms

 Test Files  2 passed (2)
      Tests  14 passed (14)
```

## `grep -rn "CLAUDE_AGENT_DOMAINS" src/ tests/`
No output (grep exit code 1 — zero matches, including in comments).

## Full suite confirmation
Ran `npx vitest run` (full suite, 133s). Result: `Test Files 2 failed | 82 passed (84)`, `Tests 3 failed | 469 passed (472)`. The 3 failures are exactly the pre-declared known-RED set, unchanged by this task:
- `tests/main/store/definition-spec.test.ts` — "round-trips a full spec" (missing `agent` in persisted round-trip) → Task 5
- `tests/main/store/definition-spec.test.ts` — "persists an empty-children spec" (same cause) → Task 5
- `tests/renderer/wizard/draft.test.ts:149` — "builds a DefinitionSpec with the workspace as the primary mount" (missing `agent` in `toSpec` output) → Task 6

No other failures. These are not mine and were left untouched.

## Self-review findings
- Diff matches the brief's prescribed code exactly: `allowedDomains` now derives `agentDomains` from `AGENT_PROFILES[spec.definition.agent].domains` and splices it into the same position `CLAUDE_AGENT_DOMAINS` previously occupied; ordering/dedup logic (`[...new Set(...)]`, trim-filter) unchanged.
- Confirmed via `git diff` that `buildLoginKit` and `OAUTH_LOGIN_DOMAINS` are byte-for-byte unchanged.
- Confirmed the only edit to `src/shared/agents.ts` is the one comment line — no `AGENT_PROFILES` values, no `CLAUDE_DOMAINS` array contents, touched.
- Confirmed `tests/main/kit/write.test.ts` has zero diff (git status shows it unmodified).
- No stray references to `CLAUDE_AGENT_DOMAINS` anywhere (grep above).
- Did not touch `src/renderer/wizard/draft.ts:208` or `src/main/defio/bundle.ts:40` stubs — out of scope for this task (Tasks 6/8).

## Assessment: opencode empty-allowlist question

Traced through `allowedDomains` for an opencode definition on the `locked` tier with no user domains, no credentials, no host services:
- `tierBase = []` (locked tier contributes nothing)
- `agentDomains = AGENT_PROFILES['opencode'].domains = []` (by design)
- `spec.domains = []`, `svc = []`, `hostSvc = []`

Result: `allowedDomains` returns `[]`. In `buildKitSpec`, the `if (domains.length)` guard means the generated kit YAML omits the `network:`/`allowedDomains:` block entirely. What that means downstream depends on the `sbx` mixin-kit runtime's default when no `network.allowedDomains` key is present at all — if the underlying proxy defaults to deny-all in that case (consistent with "locked" tier semantics), then a locked-tier opencode sandbox with no domains configured would have zero network reachability, including to whatever LLM provider the user intends to route to. That would make the sandbox unusable for its actual purpose until the user manually adds their provider's domain via the wizard's custom-domains field.

This is very likely the intended consequence of opencode being multi-provider (there is no single "opencode domain" to fall back to), and the design deliberately pushes that configuration onto the user via the existing custom-domains field rather than guessing. I implemented the brief exactly as written and did not invent a fallback domain, per the explicit instruction not to override this design decision. Flagging this because the UX implication (a freshly-created opencode/locked-tier definition with no domains added yet will have no network path in its kit) is real and worth Task 6 (wizard) or Task 9/10 (docs/UX) explicitly warning the user to add a provider domain before first launch — not something I should silently patch here.

---

## Fix round 1 (review response)

**Finding addressed (Important):** the empty-allowlist path (`buildKitSpec`'s `if (domains.length)` guard, `src/main/kit/generate.ts:54`) became reachable on the locked tier for the first time in this task's diff, but was only described in prose in the original report, not pinned by an assertion.

**Change made (test-only, `tests/main/kit/generate.test.ts`):**
- Added `it('emits no network block for an opencode-agent definition with no user domains/credentials/host services (locked tier) — deliberate multi-provider gap, not a fallback to Claude', ...)`: builds a locked-tier opencode spec with no user domains, no credentials, no host services, and asserts `specYaml` contains neither `network:` nor `allowedDomains`, plus explicitly asserts the absence of `api.anthropic.com`. A comment above the test explains this is the deliberate multi-provider consequence (opencode's `AGENT_PROFILES` entry ships `domains: []`), not an oversight, and notes the user is expected to add their provider's domain via the wizard's custom-domains field (Task 6 owns the inline hint for agents with no built-in domains).
- Closed the Minor coverage gap: added `it('does not allowlist the Claude domains for a codex-agent definition', ...)` and `it('does not allowlist the Codex/Copilot domains for a claude-agent definition', ...)`, pinning the agent→domain mapping in both directions rather than only proving one absence per agent.

**No production code changed.** `src/main/kit/generate.ts` is untouched from the prior commit — confirmed via `git diff --stat` showing only `tests/main/kit/generate.test.ts` modified before commit.

**Discrimination check for the empty-allowlist test:** temporarily edited `allowedDomains` in `src/main/kit/generate.ts` (uncommitted, scratch-only) to simulate the exact regression the reviewer is worried about — falling back to Claude's domains when the agent's own list is empty:
```ts
const agentDomains = AGENT_PROFILES[spec.definition.agent].domains.length
  ? AGENT_PROFILES[spec.definition.agent].domains
  : AGENT_PROFILES.claude.domains
```
Ran `npx vitest run tests/main/kit/generate.test.ts -t "opencode-agent definition with no user domains"` against that mutation: the new test failed as expected (`expected '...' not to contain 'network:'`, showing the emitted YAML now had a full `network: allowedDomains:` block populated with all seven Claude domains). This confirms the test genuinely discriminates against a Claude-fallback regression. Then restored `generate.ts` from a pre-edit backup (`cp` from `/tmp/.../scratchpad/generate.ts.bak`) and verified `git status --short` showed only the test file modified, with `git diff --stat` on `generate.ts` empty (no changes).

**Re-verification after restore:**
`npm run typecheck` — exit 0, zero errors (`tsc --noEmit`, no output).
`npx vitest run tests/main/kit/`:
```
 ✓ tests/main/kit/write.test.ts (2 tests) 18ms
 ✓ tests/main/kit/generate.test.ts (15 tests) 55ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
```

**Commit:** `b7165147eee20b72ad5046a6bc6bb412c3c72da5` — "test: pin opencode empty-allowlist branch and reverse-direction agent domain isolation" (test-only, `tests/main/kit/generate.test.ts` alone, +22 lines).

No changes made to `buildLoginKit`/`OAUTH_LOGIN_DOMAINS`, `src/renderer/wizard/draft.ts:208`, or `src/main/defio/bundle.ts:40`. Did not attempt to fix the 3 known-RED failures (out of scope, owned by Tasks 5/6).
