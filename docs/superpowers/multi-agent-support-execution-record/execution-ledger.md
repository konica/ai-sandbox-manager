# SDD ledger — plan: docs/superpowers/plans/2026-07-28-multi-agent-support.md

Worktree: /c/Data/Projects/ai-sandbox-manager/.claude/worktrees/multi-agent-support
Branch: worktree-multi-agent-support
Base commit: 5d94900
Env note: node_modules copied from /home/agent/build/multi-agent-support (virtiofs blocks symlinks);
  .bin shims are plain shell scripts, not symlinks.

## Pre-flight rulings (human, before Task 1)
- Typecheck gate: Task 2 fixes ALL test fixtures at once. Typecheck green from Task 2 onward.
  Caveat found while applying: a few round-trip assertions still fail until their own task lands
  (enumerated in Task 2). Per-task gate = typecheck green + that task's scoped tests green;
  full suite green at Task 8.
- CLAUDE_AGENT_DOMAINS: DELETE it in Task 4 (dead + duplicates agents.ts). buildLoginKit/OAUTH_LOGIN_DOMAINS untouched.
- Task 7 opencode attach test: rename to what it actually verifies (regression guard), do not claim
  it proves agent-awareness (all seed profiles share resumeArgs ['--continue']).
- Baseline verified before Task 1: typecheck clean; npm test = 83 files / 454 tests all passing.
- Plan amended in-place to carry all three rulings (Global Constraints + Tasks 2,3,4,5,6,7,8).

## Task log
Task 1: complete (commits 5d94900..75fc09f, review clean — spec ✅, quality approved)
Task 1: minor (deferred): `Object.keys(VARIANT_AGENT) as BuiltinVariant[]` cast in agentFromBaseImage is unchecked (low risk — Record decl already enforces exhaustiveness).
Task 1: minor (deferred): codex/copilot `sessionNameArgs: () => []` not directly asserted by any test (gap originates in the plan's test spec, not the implementer).
Task 1: controller follow-up applied — Task 4 brief amended to also fix the now-stale CLAUDE_AGENT_DOMAINS reference in the agents.ts comment.
Task 2: implementer went beyond brief file list (accepted by controller — plan's file list was
  incomplete, my error): (a) tests/main/ipc.test.ts:115 fixture the list missed; (b) draft.ts toSpec
  and (c) bundle.ts normalizeEntry each got a hardcoded `agent: 'claude'` STUB, unavoidable because
  both construct Definition literals and typecheck could not be clean without them.
  MITIGATION APPLIED: plan Tasks 6 and 8 now carry an explicit "PLACEHOLDER YOU MUST REPLACE"
  warning + a grep gate, so the stubs cannot survive to merge. Briefs 6/8 regenerated.
  RISK IF MISSED: stub silently forces every definition/import to claude — the exact bug this plan fixes.
Task 2: complete (commits 75fc09f..c2c8d92, review clean — spec ✅, quality ✅, no findings; typecheck clean, 459/462 with 3 expected-RED)
CONTROLLER SEQUENCING CHANGE (after Task 3): run Task 7 NEXT, before Tasks 4/5/6/8.
  Why: Task 3 changed agentAttachCommand's signature, leaving 2 typecheck errors in ipc.ts and
  4 runtime ipc test failures. Task 7 is the only task that clears them and depends solely on
  Tasks 2+3 (both done). Running it now restores typecheck-clean and shrinks the expected-RED set
  back to the 3 Task-2 round-trips, so Tasks 4/5/6/8 implementers get an unambiguous gate instead
  of having to reason about which of 7 failures are theirs. No task content changes; order only.
  Remaining order: 7 → 4 → 5 → 6 → 8 (8 stays last: it owns the final full-suite-green check).
Task 3: review — spec ✅, scope ✅; 1 Important + 2 Minor. Important (resumeArgs.join bypasses
  shell quoting) and Minor #1 (dangling `--` + silently dropped session name for codex/copilot)
  were BOTH plan-mandated → escalated to human → ruling: FIX BOTH. Fix round 1 dispatched.
Task 3: minor (deferred): agentAttachCommand opencode test cannot distinguish agent-aware from
  hardcoded behavior (all seed profiles share resumeArgs ['--continue']); gap originates in the
  plan's prescribed test, same root cause as the Task 7 naming ruling.
Task 3: fix round 1/5 (2 addressed, 0 open — quoting via shellCommand; conditional `--` separator;
  commits b3086e8..99f15de). Re-review: both ADDRESSED, tests verified discriminating (mutation test
  on resumeArgs + codex no-separator test both fail on revert), Claude output byte-identical, no new breakage.
Task 3: complete (commits c2c8d92..99f15de, review clean after 1 fix round)
Task 7: review — spec ✅, implementation correct/non-regressive, typecheck restored to ZERO errors.
  1 Important: the implementer's extra spy test does not discriminate — reviewer mutated the handler
  to discard the lookup result and the test still passed. NOT plan-mandated (implementer's own
  addition), so straight to fix loop. Fix round 1 dispatched: use Task 3's profile-mutation
  technique + prove red-on-hardcode.
Task 7: fix round 1/5 (1 addressed, 0 open — spy test replaced with profile-mutation test that
  provably fails on hardcoded claude; commits 7ac5d71..307147d, test-only). Re-review verified
  discrimination independently in BOTH directions, confirmed try/finally restoration hygiene,
  store-double fidelity, prescribed test untouched, working tree left clean.
Task 7: complete (commits 99f15de..307147d, review clean after 1 fix round). Typecheck ZERO errors.
  Expected-RED set back to 3 (definition-spec ×2 → Task 5, draft.test.ts:149 → Task 6).
Task 4: review — spec ✅, tier paths correct, Claude byte-identical, deletions clean, tests
  discriminate. 1 Important: the `if (domains.length)` guard in buildKitSpec was DEAD on locked
  tier before this diff (CLAUDE_AGENT_DOMAINS was spliced unconditionally); Task 4 makes the
  zero-length branch reachable (locked + opencode `domains: []` + nothing else) → kit emits NO
  network block → sandbox has no reachable network. Untested. Fix round 1 dispatched (test-only).
Task 4: minor (folded into fix round 1): no test asserted codex/claude don't get each other's domains.
HUMAN RULING (opencode network UX): add an inline wizard hint, not a default domain and not
  docs-only. Plan Task 6 amended with `needsProviderDomainHint` helper + i18n (en+de) + tests;
  explicitly a hint, must NOT block canAdvance/saving. Brief 6 regenerated.
Task 4: fix round 1/5 (2 addressed, 0 open — empty-allowlist regression test + reverse-direction
  domain isolation; commits 7fa5790..b716514, test-only +22 lines). Re-review independently
  verified discrimination (simulated Claude-fallback → new test failed showing all 7 Claude domains
  leaking; reverted → 17/17 pass), tree left clean.
Task 4: complete (commits 307147d..b716514, review clean after 1 fix round)
CONTROLLER HARDENING (pre-flight of Task 8): plan amended — normalizeEntry must NOT blind-cast
  def.agent. bundle.ts parses untrusted user-supplied .sbx.json; it already typeof-gates
  name/baseImage/tier, and a junk `agent` would reach AGENT_PROFILES[agent] → undefined → throw at
  launch. Added normalizeAgent() helper keyed off AGENT_PROFILES (no duplicated agent list) +
  tests for "bogus" string and non-string values. Brief 8 regenerated.
Final-review MERGE_BASE (main..HEAD): 5d94900e83097da6f2b67ff9ba38e1e6d42cb6c4
Task 5: complete (commits b716514..4b7eb8d, review clean — spec ✅ all 6 definition-SQL sites
  verified exhaustively; quality ✅ no Critical/Important). Reviewer proved empirically with throwaway
  DBs: suffix-anchoring safe (claude-code-docker/-minimal → claude; my-opencode-fork:v2 → claude;
  :codex-experimental → claude), custom refs default claude, ADD COLUMN NOT NULL DEFAULT on populated
  table doesn't throw, reopen idempotent, and CRITICALLY a user's edited agent survives reopen
  (backfill does not re-clobber), round-trip preserves 'opencode' via both read paths.
Task 5: minor (deferred): implementer's own idempotency test doesn't itself prove the no-clobber
  property (no mismatched-agent row); reviewer's probe closed the gap but that probe was deleted.
  Consider adding a permanent no-clobber regression test.
Task 5: definition-spec round-trips now GREEN. Only remaining RED: draft.test.ts:149 (Task 6).
Task 6: complete (commits 4b7eb8d..18610a0, review clean — spec ✅ all items, quality ✅ no
  Critical/Important). CRITICAL stub in toSpec removed and end-to-end flow traced by reviewer:
  UI onChange → setAgent/setImageChoice → Draft.agent → toSpec → Definition.agent, nothing
  downstream re-hardcodes. Hint: all 3 clauses load-bearing, advisory-only (canAdvance untouched),
  real German, interpolates display label not id. FULL SUITE GREEN: 85 files / 487 tests.
Task 6: brief error found by implementer (controller's fault): brief claimed Task 2 had added
  `agent` to draft.test.ts:149's toEqual — it had not. Root cause: Task 2 used typecheck errors as
  its worklist, and a bare object literal on toEqual's expected side isn't type-checked against
  Definition, so it was invisible to that sweep though genuinely RED. Reviewer adjudicated the
  implementer's fix as correct (passes because toSpec genuinely propagates d.agent), not papering over.
Task 6: minor (deferred): no test for draftFromSpec round-tripping a CUSTOM baseImage with a
  non-claude agent (builtin-variant case is covered; impl is agent-field-driven so low risk).
Task 8: complete (commits 18610a0..ea63e2c, review clean — spec ✅, quality: 0 Critical/Important,
  1 Minor). Reviewer probed normalizeAgent with hostile inputs (constructor/toString/hasOwnProperty/
  __proto__/valueOf/isPrototypeOf/42/true/null/undefined/{}/[]/["claude"]) — ALL correctly fell
  through to the safe default; hasOwnProperty.call idiom verified sound. Last stub removed; repo-wide
  only remaining `agent: 'claude'` is initialDraft's legitimate default. FULL SUITE 491/491 GREEN.
Task 8: minor (deferred): export→import round-trip for a NON-claude agent is untested end-to-end
  (each direction proven only in isolation; bundle.test.ts's spec() helper is hardcoded to claude).

## ALL 8 TASKS COMPLETE. Deferred-minor list for final whole-branch review triage:
 M1 (Task 1) `Object.keys(VARIANT_AGENT) as BuiltinVariant[]` unchecked cast in agentFromBaseImage.
 M2 (Task 1) codex/copilot `sessionNameArgs: () => []` never directly asserted.
 M3 (Task 3) agentAttachCommand per-agent test can't distinguish agents (all seed profiles share
    resumeArgs ['--continue']) — same root cause as the Task 7 test-naming ruling.
 M4 (Task 5) implementer's idempotency test doesn't itself prove the no-clobber property; the
    reviewer's probe that DID prove it was deleted. No permanent regression test for data-loss risk.
 M5 (Task 6) no test for draftFromSpec round-tripping a CUSTOM baseImage + non-claude agent.
 M6 (Task 8) export→import round-trip untested end-to-end for a non-claude agent.
KNOWN LIMITATION (by design, spec'd): opencode/codex/copilot domains + resumeArgs/sessionNameArgs
 are best-effort placeholders carrying TODO comments. Only claude's are verified. opencode ships
 domains: [] deliberately (multi-provider) — surfaced to users via Task 6's wizard hint.

## FINAL WHOLE-BRANCH REVIEW (opus): APPROVE WITH FOLLOW-UPS
CORRECTION to my earlier M4 note: the no-clobber property IS permanently pinned. Final reviewer
  probed it — making the backfill unconditional fails db-agent-migration.test.ts:58 with
  "expected 'codex' to be 'claude'", because that test's fixture (agent 'claude' + baseImage
  ...:codex) is itself a mismatched row. My M4 deferral was based on a wrong reading. M4 = won't-fix.
Triage: M1 won't-fix (Record guarantees keys). M2 won't-fix (covered behaviourally by Task 3's
  no-dangling-`--` codex test). M3 won't-fix (property proven by the two mutation tests; weak test
  honestly labelled). M4 won't-fix (see correction). M5 fix-later. M6 fix-later.
IMPORTANT #1: custom-image path still reproduces the ORIGINAL 500 bug. Pick "Custom registry
  image…", enter a ref ending :opencode, leave Agent select at its default (Claude, first in
  Object.values) → emits `create claude ... --template ...:opencode`. On reopen, draftFromSpec
  matches knownVariant so the Agent select disappears and read-only text says "Agent: Claude Code"
  while the template dropdown says opencode. Faithful to design §C → plan-mandated → human decides.
IMPORTANT #2: needsProviderDomainHint does not cover the IMPORT path (ipc.ts:144-156 inserts
  imported specs directly; no wizard involved). Importing an opencode/locked/no-domains bundle then
  launching yields a kit with NO network block and no warning anywhere. Also: the hint clears on ANY
  domain being added, so adding api.github.com silences it while the provider is still unreachable.
FINAL FIX WAVE: complete (commits ea63e2c..c4b0052). Scoped re-review: all 4 fixes ADDRESSED,
  no new breakage, tree clean, merge recommended.
  FIX1 verified by live replay through the real reducer → toSpec → specToCreateArgs:
    observed argv ["sbx","create","opencode",...,"--template","...:opencode"] — original 500 repro CLOSED.
    Anti-clobber verified: unrecognized/partial refs leave a user's chosen agent untouched;
    explicit setAgent survives unrelated edits; agentFromBaseImage's other callers unchanged.
  FIX2 verified single implementation (grep: one occurrence of the condition, in provider-domain.ts),
    import warning additive (insertDefinitionSpec still unconditional), canAdvance untouched, real German.
  FIX3/FIX4 verified. Claude behaviour byte-identical — no pre-existing Claude assertion edited anywhere.
FINAL STATE: typecheck clean; 86 files / 504 tests green; 12 commits on branch.
REMAINING FOLLOW-UPS (none blocking): M5/M6 were closed by FIX4. Won't-fix: M1-M4 (properties
  covered elsewhere; M4's no-clobber IS permanently pinned by db-agent-migration.test.ts:58).
  Open follow-up: SbxInstance.agent unused for unmanaged instances; two ?? 'claude' fallbacks in
  ipc.ts not unified; agent not shown in the Definitions list.
KNOWN LIMITATION FOR RELEASE NOTES: claude verified-working & byte-identical. opencode creates
  without the 500 but its network allowlist is the user's responsibility (domains: [] by design).
  codex/copilot are selectable-without-crashing only — they silently drop session names and their
  '--continue' resume flag is an unverified guess. Do NOT claim codex/copilot work.
