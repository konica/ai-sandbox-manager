# Task 7 report — resolve the right agent for attach/manual commands

## Files changed
- `src/main/ipc.ts`
  - Added `import type { AgentId } from '@shared/agents'`
  - Added `resolveAgentForInstance(deps, name)` helper (after `requireCreds`, before `wrap`)
  - `instance:attach`: moved the `meta`/`spec` lookup above the `agentAttachCommand` call and
    passed `spec?.definition.agent ?? 'claude'` as the second argument (no call to the helper —
    reuses the existing inline lookup already used for credential re-registration and
    `workspaceDir`)
  - `instance:commands`: now calls `agentAttachCommand(name, resolveAgentForInstance(deps, name))`
- `tests/main/ipc.test.ts`
  - Added `it('instance:attach resumes a non-claude (opencode) definition correctly', …)` exactly
    as prescribed in the brief, including the caveat comment about `resumeArgs` being identical
    across all four seed profiles.
  - Added one further test, `it('instance:commands looks up the definition linked to the
    instance', …)`, which spies on `store.getDefinitionSpec` and asserts it was called with the
    instance's `definitionId` — this discriminates real agent-awareness from a hardcoded
    `'claude'`, which the prescribed test alone cannot do.

## Before: typecheck (2 errors, as expected)
```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit

src/main/ipc.ts(167,19): error TS2554: Expected 2 arguments, but got 1.
src/main/ipc.ts(202,63): error TS2554: Expected 2 arguments, but got 1.
```

## Before: scoped test run (5 failures: 4 pre-existing + the new RED test)
```
 FAIL  tests/main/ipc-lifecycle.test.ts > instance lifecycle IPC > instance:attach and instance:shell open a terminal with the right command
 FAIL  tests/main/ipc-lifecycle.test.ts > instance lifecycle IPC > instance:attach re-registers the definition's current credentials scoped to the instance (picks up creds added since launch)
 FAIL  tests/main/ipc.test.ts > buildHandlers > instance:attach with vscode opener resolves the workspace and opens VS Code
 FAIL  tests/main/ipc.test.ts > buildHandlers > instance:commands returns the manual agent + shell commands
 FAIL  tests/main/ipc.test.ts > buildHandlers > instance:attach resumes a non-claude (opencode) definition correctly

 Test Files  2 failed | 2 passed (4)
      Tests  5 failed | 30 passed (35)
```

## After: typecheck — ZERO errors
```
> ai-sandbox-manager@0.1.6 typecheck
> tsc --noEmit

(no output — clean exit)
```

## After: scoped test run — all green
```
 ✓ tests/main/ipc-lifecycle.test.ts (9 tests) 84ms
 ✓ tests/main/ipc-definitions.test.ts (5 tests) 119ms
 ✓ tests/main/ipc-ports.test.ts (6 tests) 168ms
 ✓ tests/main/ipc.test.ts (16 tests) 231ms

 Test Files  4 passed (4)
      Tests  36 passed (36)
```

## After: full suite — exactly 3 remaining failures, all pre-existing and not owned by this task
```
 FAIL  tests/main/store/definition-spec.test.ts > definition spec persistence > persists a full spec round-trip
 FAIL  tests/main/store/definition-spec.test.ts > definition spec persistence > persists an empty-children spec
 FAIL  tests/renderer/wizard/draft.test.ts (draft.test.ts:149, per the task brief)

 Test Files  2 failed | 82 passed (84)
      Tests  3 failed | 467 passed (470)
   Duration  138.59s
```
Both `definition-spec.test.ts` failures assert-diff shows only `agent: "claude"` missing from the
persisted round-trip and an extraneous `kitCommandsYaml: undefined` — Task 5's `db.ts` persistence
scope, untouched by this task. `draft.test.ts` is Task 6's wizard scope. Re-ran
`tests/main/store/definition-spec.test.ts tests/renderer/wizard/draft.test.ts` directly to confirm
these are the same 3 failures (3 failed, 24 passed in that pair) and not new regressions.

## Diff
```
diff --git a/src/main/ipc.ts b/src/main/ipc.ts
index 63aa2af..dae686f 100644
--- a/src/main/ipc.ts
+++ b/src/main/ipc.ts
@@ -1,5 +1,6 @@
 import { ipcMain, dialog, BrowserWindow } from 'electron'
 import type { Result, PrereqResult, InstanceView, DefinitionSpec, Definition, GlobalSecretMeta, EnvHit, LivePort, PolicySummary, AuthStatus, KitValidation, StorageStatus } from '@shared/types'
+import type { AgentId } from '@shared/agents'
 import type { SbxAdapter } from './sbx/adapter'
 import type { Store } from './store/db'
 import { checkPrereqs, type Probes } from './prereq'
@@ -49,6 +50,15 @@ function requireCreds(deps: Deps): CredentialManager {
   return deps.creds
 }
 
+/** The agent to resume/attach with: the linked definition's own agent, or 'claude' when the
+ * instance isn't tracked by the app (no definition to consult) — matching the app's
+ * pre-multi-agent behavior for anything it doesn't manage. */
+function resolveAgentForInstance(deps: { store: Pick<Store, 'listInstanceMeta' | 'getDefinitionSpec'> }, name: string): AgentId {
+  const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
+  const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
+  return spec?.definition.agent ?? 'claude'
+}
+
 async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
   try {
     return { ok: true, data: await fn() }
@@ -164,9 +174,9 @@ export function buildHandlers(deps: Deps): {
       definitionId, name, sessionName, opener ?? 'terminal'
     )),
     'instance:attach': (name, opener) => wrap(async () => {
-      const cmd = agentAttachCommand(name)
       const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
       const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
+      const cmd = agentAttachCommand(name, spec?.definition.agent ?? 'claude')
       // Re-register the definition's current credentials scoped to this instance so any
       // added/changed since the initial launch are synced into sbx before the agent runs.
       if (spec && deps.creds && meta?.definitionId && spec.credentials.length > 0) {
@@ -199,7 +209,7 @@ export function buildHandlers(deps: Deps): {
       return null
     }),
     // The exact sbx commands to run the agent / open a shell manually (for copy-to-clipboard).
-    'instance:commands': (name) => wrap(async () => ({ agent: agentAttachCommand(name), shell: hostShellCommand(name) })),
+    'instance:commands': (name) => wrap(async () => ({ agent: agentAttachCommand(name, resolveAgentForInstance(deps, name)), shell: hostShellCommand(name) })),
     'instance:stop': (name) => wrap(async () => { await deps.adapter.stopSandbox(name); return null }),
     'instance:remove': (name) => wrap(async () => { await cleanupInstance(deps, name); return null }),
     'secret:listGlobal': () => wrap(async () => requireCreds(deps).listGlobalSecrets()),
```
(test diff omitted here; see `tests/main/ipc.test.ts` — two new `it(...)` blocks added after
`instance:commands returns the manual agent + shell commands`.)

## Commit
`7ac5d714569306c64760940d0823609480aea638` — "feat: resolve the instance's own agent for attach and manual commands"
Files: `src/main/ipc.ts`, `tests/main/ipc.test.ts`

## Self-review findings
- `instance:attach` does not call `resolveAgentForInstance` — confirmed by diff: it reuses the
  existing `meta`/`spec` lookup inline, exactly as the brief requires.
- The `'claude'` fallback and its explanatory comment are present verbatim in the new helper.
- No fixture or unrelated file was touched; `git status --short` shows only `src/main/ipc.ts` and
  `tests/main/ipc.test.ts` modified.
- Did not touch `loginCommand`, `kit/generate.ts`, `db.ts`, wizard, or `bundle.ts` — verified via
  `git diff --stat` before commit (only the two intended files listed).
- The prescribed test's name and caveat comment were kept verbatim, not strengthened; the added
  second test uses a `vi.spyOn` on `getDefinitionSpec` to give real agent-awareness coverage
  without altering or removing the prescribed one.

---

## Fix round 1: the extra test did not actually discriminate (correction)

**Reviewer finding (Important):** the original `instance:commands looks up the definition linked
to the instance` test only asserted `getDefinitionSpec` was *called* with the right id. The
reviewer mutated `instance:commands` to still call `resolveAgentForInstance` (so the lookup fires)
but then discard the result and force `agentAttachCommand(name, 'claude')` — the test still
passed. **This confirms my report's original claim — "gives real agent-awareness coverage" — was
overstated; the test proved only that a lookup happened, not that its result reached the
command. Correcting that claim here.**

### Fix
Replaced the test with one that mutates `AGENT_PROFILES.opencode.resumeArgs` to a distinctive
value (`['--resume-distinctive']`) inside a `try/finally` (restoring the original afterward),
links an instance to an `opencode` definition, calls `instance:commands`, and asserts the
returned `agent` string contains the distinctive token. Against a hardcoded `'claude'`
implementation this must fail, because `claude`'s `resumeArgs` (`['--continue']`) is untouched.

**Important secondary finding surfaced while building this fix:** going through the real
`openStore(':memory:')` SQLite-backed store (as the original test and the brief's prescribed test
both do) cannot make this discrimination work today, because `src/main/store/db.ts`'s
`insertDefinitionSpec`/`getDefinitionSpec` do not yet select/persist a `Definition.agent` column
at all (no `agent` column exists in the schema) — that persistence is Task 5's still-RED scope
(the same gap visible in `tests/main/store/definition-spec.test.ts`'s two failing round-trips).
Going through the real store here would make the new test fail for the *wrong* reason (agent
info lost in the DB layer, not in `ipc.ts`) rather than the right one. So this test builds a
hand-written store double — `{ getDefinitionSpec: vi.fn(() => spec), listInstanceMeta: vi.fn(() =>
[...]) }`, `as never` — bypassing SQLite entirely, following the same pattern already used in
`tests/main/ipc-lifecycle.test.ts`'s `deps()` helper. This is a **test-only** workaround; no
production code or Task 5/6/8 scope was touched, and the coordinator was not asked to approve a
behavior change because none was made.

### Verification: confirmed the new test actually discriminates
1. Ran `npx vitest run tests/main/ipc.test.ts` against the correct implementation — **16/16
   pass**, including the new test.
2. Temporarily edited `src/main/ipc.ts`'s `instance:commands` to:
   ```ts
   'instance:commands': (name) => wrap(async () => { resolveAgentForInstance(deps, name); return { agent: agentAttachCommand(name, 'claude'), shell: hostShellCommand(name) } }),
   ```
   (lookup still fires, result discarded, agent forced to `'claude'`) — re-ran
   `npx vitest run tests/main/ipc.test.ts`:
   ```
   ❯ tests/main/ipc.test.ts (16 tests | 1 failed) 290ms
     × buildHandlers > instance:commands uses the linked definition's own agent, not always claude
       → expected 'sbx run --name \'box\' -- --continue' to contain '--resume-distinctive'
   Test Files  1 failed (1)
        Tests  1 failed | 15 passed (16)
   ```
   Only the new test failed; the other 15 (including the prescribed opencode-attach test) still
   passed — confirming the hardcode-detector is isolated to this one test.
3. Reverted `src/main/ipc.ts` to the original line (`git diff --stat -- src/main/ipc.ts` showed no
   diff after reverting, confirming an exact restore). Re-ran the same command — **16/16 pass**
   again.

### Re-verification after the fix
- `npm run typecheck` — zero errors (unchanged).
- `npx vitest run tests/main/ipc.test.ts tests/main/ipc-lifecycle.test.ts tests/main/ipc-ports.test.ts tests/main/ipc-definitions.test.ts` — **4 files, 36/36 pass**.
- `npx vitest run tests/main/store/definition-spec.test.ts tests/renderer/wizard/draft.test.ts` —
  **3 failed | 24 passed (27)**, same 3 tests as before (`round-trips a full spec`, `persists an
  empty-children spec`, `builds a DefinitionSpec with the workspace as the primary mount`).
- Full suite (`npx vitest run`) — **Test Files 2 failed | 82 passed (84)**, **Tests 3 failed | 467
  passed (470)** — the same 3 pre-existing round-trips, nothing else changed.

### Files touched in this fix round
- `tests/main/ipc.test.ts` only (added `import { AGENT_PROFILES } from '@shared/agents'`;
  replaced the non-discriminating test). `src/main/ipc.ts` was touched only transiently for the
  verification step above and reverted to its exact original state before commit — confirmed via
  `git diff --stat`.

### Commit (fix round 1)
`307147d79e5490a68a0aae77c189866f9dfcb65c` — "test: make the instance:commands agent-awareness
test actually discriminate" (`tests/main/ipc.test.ts` only; `.superpowers/` report file is
gitignored in this repo, so it is updated in place but not part of any commit).
