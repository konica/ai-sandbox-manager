# Task 3 Report: `src/main/sbx/translate.ts` — agent-aware command construction

## Status: DONE

## Commit
`b3086e8` — "feat: make sbx create/run command construction agent-aware"

## Files changed

- `src/main/sbx/translate.ts`
  - Removed `export const AGENT_KEYWORD = 'claude'`.
  - Added `import { AGENT_PROFILES } from '@shared/agents'` and `import type { AgentId } from '@shared/agents'`.
  - `specToCreateArgs`: `args = ['create', AGENT_PROFILES[spec.definition.agent].keyword, primary.hostPath]` (was `AGENT_KEYWORD`).
  - `agentAttachCommand(name: string, agent: AgentId): string` — now takes `agent` and builds `... -- ${AGENT_PROFILES[agent].resumeArgs.join(' ')}` (was hardcoded `-- --continue`).
  - `launchCommand`: session-name args now come from `AGENT_PROFILES[spec.definition.agent].sessionNameArgs(sessionName.trim())` (was hardcoded `'--name', sessionName.trim()`).
  - `loginCommand` left untouched — still hardcoded to `'claude'` (OAuth `/login` flow is out of scope for the whole plan).
- `tests/main/sbx/translate.test.ts`
  - Import block: removed `AGENT_KEYWORD`, added `import { AGENT_PROFILES } from '../../../src/shared/agents'`.
  - `specToCreateArgs`: existing test now asserts `AGENT_PROFILES.claude.keyword`; added "uses the opencode keyword for an opencode-agent definition".
  - `shell command builders`: `agentAttachCommand('my-project', 'claude')` assertion updated; added "agentAttachCommand uses the given agent's resumeArgs" (opencode case, same `--continue` since opencode's `resumeArgs` also `['--continue']`).
  - `launchCommand`: added "appends the session name using the opencode --session flag for an opencode definition".
- `tests/main/sbx/translate-copyfiles.test.ts:74`
  - `agentAttachCommand('sbx-x')` → `agentAttachCommand('sbx-x', 'claude')`.

No fixture `agent:` fields were added/re-added anywhere — all were already present from Task 2.

## Step 2 — failing run (before implementation)

```
❯ tests/main/sbx/translate.test.ts (27 tests | 2 failed) 140ms
   × specToCreateArgs > uses the opencode keyword for an opencode-agent definition 63ms
     → expected [ 'create', 'claude', …(5) ] to deeply equal [ 'create', 'opencode', …(5) ]
   × launchCommand > appends the session name using the opencode --session flag for an opencode definition 5ms
     → expected 'sbx create claude /home/u/proj --name…' to match /&& sbx run --name my-project -- --ses…/

 Test Files  1 failed | 10 passed (11)
      Tests  2 failed | 77 passed (79)
```
Failed for the expected reason: `specToCreateArgs`/`launchCommand` still hardcoded to the `claude` keyword/`--name`, not yet consulting `AGENT_PROFILES[spec.definition.agent]`. (No TS compile-time error surfaced here because vitest's esbuild transform strips types without type-checking, so the `agentAttachCommand` 1-arg/2-arg mismatch didn't fail at this stage — it correctly does under `tsc`, see below.)

## Step 4 — passing run (after implementation)

```
✓ tests/main/sbx/parse.test.ts (8 tests) 31ms
✓ tests/main/sbx/policy-log.test.ts (5 tests) 58ms
✓ tests/main/sbx/translate-login.test.ts (1 test) 16ms
✓ tests/main/sbx/translate-ssh.test.ts (7 tests) 27ms
✓ tests/main/sbx/translate-ports.test.ts (2 tests) 16ms
✓ tests/main/sbx/translate-copyfiles.test.ts (13 tests) 37ms
✓ tests/main/sbx/translate-kit.test.ts (2 tests) 33ms
✓ tests/main/sbx/adapter-secret.test.ts (5 tests) 31ms
✓ tests/main/sbx/adapter-ports.test.ts (6 tests) 33ms
✓ tests/main/sbx/adapter.test.ts (3 tests) 55ms
✓ tests/main/sbx/translate.test.ts (27 tests) 71ms

 Test Files  11 passed (11)
      Tests  79 passed (79)
```

## `npm run typecheck` output

```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit

src/main/ipc.ts(167,19): error TS2554: Expected 2 arguments, but got 1.
src/main/ipc.ts(202,63): error TS2554: Expected 2 arguments, but got 1.
```

Confirmed both errors are the two documented `agentAttachCommand` call sites, and nothing else:
- Line 167 is inside the `instance:attach` handler: `const cmd = agentAttachCommand(name)`.
- Line 202 is inside the `instance:commands` handler: `agent: agentAttachCommand(name)`.

Both are Task 7's responsibility per the brief; not touched here.

## `AGENT_KEYWORD` removal — grep proof

Before implementing, confirmed only two files referenced it (both in scope for this task):
```
src/main/sbx/translate.ts:8:export const AGENT_KEYWORD = 'claude'
src/main/sbx/translate.ts:95:  const args = ['create', AGENT_KEYWORD, primary.hostPath]
tests/main/sbx/translate.test.ts:3:  AGENT_KEYWORD,
tests/main/sbx/translate.test.ts:92:      'create', AGENT_KEYWORD, '/home/u/proj',
```
After the change, a repo-wide grep for `AGENT_KEYWORD` (`.ts`/`.tsx`) returns no results — fully removed, no dangling imports.

## Full-suite check (informational, beyond the brief's required scope)

Ran the full suite (`npx vitest run`) to look for unintended regressions outside `tests/main/sbx/`:

```
Test Files  4 failed | 80 passed (84)
     Tests  7 failed | 458 passed (465)
```

Baseline at task start was 459/462 passing with exactly 3 known-RED tests (`definition-spec.test.ts` ×2 → Task 5, `draft.test.ts:149` → Task 6). Total tests grew from 462 → 465 (the 3 new opencode-coverage tests I added), and 3 of those pass. The delta from 3 → 7 failures is exactly 4 new failures, all in `tests/main/ipc.test.ts` and `tests/main/ipc-lifecycle.test.ts`:

- `ipc-lifecycle.test.ts > instance:attach and instance:shell open a terminal with the right command`
- `ipc-lifecycle.test.ts > instance:attach re-registers the definition's current credentials...`
- `ipc.test.ts > instance:attach with vscode opener resolves the workspace and opens VS Code`
- `ipc.test.ts > instance:commands returns the manual agent + shell commands`

Root cause: at runtime (unlike `tsc`, vitest's esbuild transform doesn't type-check), `ipc.ts`'s two `agentAttachCommand(name)` calls now pass `agent = undefined`, so `AGENT_PROFILES[undefined].resumeArgs` throws inside the handler, which the tests' assertions surface as "handler didn't call openTerminal/openVSCode/setCustomSecret as expected." This is the runtime manifestation of exactly the two call sites the brief names as deliberately left broken for Task 7 ("leaving those two call sites broken is expected, and Task 7 fixes them"). Grepped both failing test files for `agentAttachCommand` usage directly — none; they only exercise it indirectly through `ipc.ts`'s handlers, confirming these are not separate bugs.

The other 3 failures (`definition-spec.test.ts` ×2, `draft.test.ts`) are the pre-existing, unrelated Task 5/Task 6 red round-trips — confirmed via grep that neither test file references `agentAttachCommand` at all.

No regression outside the two documented, sanctioned `ipc.ts` call sites.

## Self-review findings

- Diff matches the brief's prescribed code exactly (import placement, `specToCreateArgs`, `agentAttachCommand`, `launchCommand` session-args block).
- `loginCommand` left untouched — still hardcoded `'claude'`, per the global constraint.
- Did not touch `kit/generate.ts`, `db.ts`, wizard, `ipc.ts`, or `bundle.ts` — out of scope for this task.
- Did not re-add any `agent:` fixture fields — all were already present from Task 2's sweep.
- `tests/main/sbx/translate.test.ts`'s new opencode `agentAttachCommand` case intentionally asserts the same `--continue` output as claude, since opencode's `resumeArgs` in `AGENT_PROFILES` is also `['--continue']` — this exercises the parameterization (a different `agent` argument flows through) even though the profile data happens to coincide for `resumeArgs`; the `sessionNameArgs` case (`--session` vs `--name`) is where opencode's distinct behavior is actually visible.
- Scoped run (`tests/main/sbx/`) and `npm run typecheck` both match the brief's Step 4 exactly. The full-suite run was extra verification (not required by the brief) and confirms the only fallout is the two sanctioned `ipc.ts` call sites plus the 3 pre-existing unrelated Task 5/6 failures.

---

# Fix round 1 of 5 (post-review)

Two findings from review, ruled by the human as "fix both" (superseding the brief's literal prescribed code for `agentAttachCommand`/`launchCommand`).

## Commit
`99f15de` — "fix: quote resumeArgs consistently and avoid dangling -- in agentAttachCommand/launchCommand"

## Finding 1 — `agentAttachCommand` shell-quoting discipline

`src/main/sbx/translate.ts` — `agentAttachCommand` changed from raw-joining `resumeArgs` to routing them through the file's existing `shellCommand` helper (same helper `launchCommand`'s session-name path already used), so any future profile's `resumeArgs` token containing a space/shell metacharacter gets quoted instead of silently mis-parsed:

```ts
// before
return `sbx run --name ${shellQuote(name)} -- ${AGENT_PROFILES[agent].resumeArgs.join(' ')}`
// after
return `sbx run --name ${shellQuote(name)} -- ${shellCommand(AGENT_PROFILES[agent].resumeArgs)}`
```

Claude's output is unchanged and byte-identical (`--continue` is a `SAFE_ARG`-safe token either way): `sbx run --name 'my-project' -- --continue`.

## Finding 2 — dangling `--` / silently dropped session name

`src/main/sbx/translate.ts` — `launchCommand`'s run-args assembly now only pushes the `--` separator when `sessionNameArgs(...)` returns at least one token:

```ts
// before
if (sessionName && sessionName.trim()) {
  runArgs.push('--', ...AGENT_PROFILES[spec.definition.agent].sessionNameArgs(sessionName.trim()))
}
// after
if (sessionName && sessionName.trim()) {
  const nameArgs = AGENT_PROFILES[spec.definition.agent].sessionNameArgs(sessionName.trim())
  if (nameArgs.length > 0) runArgs.push('--', ...nameArgs)
}
```

For codex/copilot (`sessionNameArgs: () => []`), a non-empty session name now produces no `--` and no trace of the (unsupported) session name, instead of a dangling `sbx run --name X --`.

## Covering tests added

File: `tests/main/sbx/translate.test.ts`

- `shell command builders > agentAttachCommand is byte-identical for claude (regression guard)` — asserts `agentAttachCommand('my-project', 'claude')` still equals `"sbx run --name 'my-project' -- --continue"`.
- `shell command builders > agentAttachCommand quotes resumeArgs tokens that need it, like every other arg path` — temporarily mutates `AGENT_PROFILES.codex.resumeArgs` to `['--continue', 'a b']` (restored in a `finally`, since there's no injection point and no real profile currently has an unsafe token) and asserts the output is `"sbx run --name 'my-project' -- --continue 'a b'"` — this is the test that actually exercises Finding 1's fix; the byte-identical test alone would have passed against the old buggy code too, since `--continue` was already `SAFE_ARG`-safe.
- `launchCommand > emits no dangling -- separator for an agent with no session-name flag (codex), even with a session name given` — builds a codex-agent spec, calls `launchCommand(s, 'my-project', 'Refactor auth')`, and asserts the command matches `/&& sbx run --name my-project$/` (ends exactly there, no trailing `--`) and does not match `/\s--(\s|$)/` (no bare `--` token anywhere — distinct from the `--name`/`--template` substrings which contain `--` as a prefix, not a standalone token).

## Step: verify tests fail first (TDD)

Ran `npx vitest run tests/main/sbx/translate.test.ts` before implementing the fix — both new tests failed for the expected reason (old code, not yet fixed):

```
 ❯ tests/main/sbx/translate.test.ts (30 tests | 2 failed) 106ms
   × shell command builders > agentAttachCommand quotes resumeArgs tokens that need it, like every other arg path 39ms
     → expected 'sbx run --name \'my-project\' -- --co…' to be 'sbx run --name \'my-project\' -- --co…' // Object.is equality
   × launchCommand > emits no dangling -- separator for an agent with no session-name flag (codex), even with a session name given 6ms
     → expected 'sbx create codex /home/u/proj --name …' to match /&& sbx run --name my-project$/

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/main/sbx/translate.test.ts > shell command builders > agentAttachCommand quotes resumeArgs tokens that need it, like every other arg path
AssertionError: expected 'sbx run --name \'my-project\' -- --co…' to be 'sbx run --name \'my-project\' -- --co…' // Object.is equality

Expected: "sbx run --name 'my-project' -- --continue 'a b'"
Received: "sbx run --name 'my-project' -- --continue a b"

 FAIL  tests/main/sbx/translate.test.ts > launchCommand > emits no dangling -- separator for an agent with no session-name flag (codex), even with a session name given
AssertionError: expected 'sbx create codex /home/u/proj --name …' to match /&& sbx run --name my-project$/

- Expected:
/&& sbx run --name my-project$/

+ Received:
"sbx create codex /home/u/proj --name my-project --template docker.io/docker/sandbox-templates:codex && sbx exec my-project bash -lc 'mkdir -p ~/.ssh && chmod 700 ~/.ssh; grep -qs \"StrictHostKeyChecking accept-new\" ~/.ssh/config || printf \"Host *\\n\\tStrictHostKeyChecking accept-new\\n\" >> ~/.ssh/config; chmod 600 ~/.ssh/config' && sbx run --name my-project --"

 Test Files  1 failed (1)
      Tests  2 failed | 28 passed (30)
```

## Command run and full output — after implementing the fix

`npx vitest run tests/main/sbx/`:

```
 RUN  v2.1.9 /c/Data/Projects/ai-sandbox-manager/.claude/worktrees/multi-agent-support

 ✓ tests/main/sbx/parse.test.ts (8 tests) 32ms
 ✓ tests/main/sbx/translate-ports.test.ts (2 tests) 19ms
 ✓ tests/main/sbx/translate-login.test.ts (1 test) 19ms
 ✓ tests/main/sbx/translate-kit.test.ts (2 tests) 21ms
 ✓ tests/main/sbx/translate-ssh.test.ts (7 tests) 32ms
 ✓ tests/main/sbx/translate-copyfiles.test.ts (13 tests) 50ms
 ✓ tests/main/sbx/policy-log.test.ts (5 tests) 66ms
 ✓ tests/main/sbx/adapter-ports.test.ts (6 tests) 31ms
 ✓ tests/main/sbx/adapter.test.ts (3 tests) 53ms
 ✓ tests/main/sbx/translate.test.ts (30 tests) 95ms
 ✓ tests/main/sbx/adapter-secret.test.ts (5 tests) 37ms

 Test Files  11 passed (11)
      Tests  82 passed (82)
   Start at  06:04:40
   Duration  10.28s (transform 1.89s, setup 31.13s, collect 4.34s, tests 456ms, environment 15ms, prepare 19.97s)
```

`npm run typecheck`:

```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit

src/main/ipc.ts(167,19): error TS2554: Expected 2 arguments, but got 1.
src/main/ipc.ts(202,63): error TS2554: Expected 2 arguments, but got 1.
```

Confirmed: still exactly the same 2 known `TS2554` errors, at the same two lines (`ipc.ts:167` and `:202`) — Task 7's call sites, untouched. No new typecheck errors introduced by this fix round.

## Self-review

- Diff is minimal and surgical: only `agentAttachCommand`'s return statement and `launchCommand`'s `runArgs` assembly changed; nothing else in `translate.ts` touched.
- `shellCommand` is a `function` declaration (fully hoisted), so calling it from `agentAttachCommand` — which is defined earlier in the file, textually — works correctly regardless of declaration order.
- Verified via `git diff` that the diff contains no stray changes (e.g., no re-touching of `loginCommand`, `specToCreateArgs`, or any file outside `translate.ts`/`translate.test.ts`).
- `AGENT_PROFILES.codex.resumeArgs` mutation in the new quoting test is scoped with try/finally to avoid leaking state into other tests; ran the full `tests/main/sbx/` file afterward (82/82 pass) to confirm no cross-test contamination.
- Did not touch `ipc.ts` per the explicit instruction — confirmed via `npm run typecheck` that the only errors are the same two pre-existing, Task-7-owned `TS2554`s.
