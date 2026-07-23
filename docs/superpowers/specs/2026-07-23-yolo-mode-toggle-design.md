# Yolo-Mode Toggle on Launch & Re-attach — Design

**Date:** 2026-07-23
**Status:** Approved (brainstorming)

## Goal

Let the user enable or disable **Yolo mode** — the coding agent skipping
permission prompts (auto-approving actions) — each time they **start** a new
instance or **re-attach** to an existing one. Today the agent always runs in
Yolo mode; this adds a per-action choice, defaulting to ON so current behavior
is unchanged unless the user opts out.

## Background — how Yolo is enabled today (investigated, not assumed)

The app launches the agent with `sbx run … -- <agent args>`; args after `--`
pass to Claude Code. Investigation of a live sandbox found:

- `sbx run` has **no** permission/yolo flag of its own; the sbx binary contains
  no `--dangerously-skip-permissions` / `--permission-mode` string.
- Inside the sandbox `claude` is a plain native binary (no wrapper injecting a
  flag), and `~/.claude.json` carries no permission setting.
- `IS_SANDBOX=1` is set in the sandbox environment — Claude Code's signal that
  bypassing permissions as root is permitted; the Yolo default derives from the
  sandbox environment, not from our code or an sbx-injected flag.

**Consequence:** the control point is a Claude Code permission flag passed after
`--`. Because nothing force-injects `--dangerously-skip-permissions`, an explicit
`--permission-mode default` on the OFF path has nothing to fight and will make
the agent prompt normally. This is the mechanism; the user does a one-time live
sanity check after implementation (see Testing).

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Control model | **Per-launch / per-attach choice, chosen each time, NOT persisted.** |
| Default | **ON** (yolo) — preserves today's behavior. |
| Scope | Applies to **start (launch)** and **re-attach**. `instance:rebuild` is unchanged (implicitly ON). |
| Flag mechanism | **ON → append nothing** (the sandbox already defaults to yolo via `IS_SANDBOX=1`, so ON = today's exact command). **OFF → append `--permission-mode default`** after `--`. Additive-only, so ON-path commands (and their existing tests) are unchanged. |
| Parameter shape | `yolo` is **optional, default `true`** on the command builders and `launchDefinition`, so `rebuild` and existing callers/tests keep current behavior; the UI always passes an explicit value. |

## Architecture / components

### Command builders — `src/main/sbx/translate.ts`
A single helper turns the boolean into the (possibly empty) flag tokens:

```ts
// Claude Code permission args appended after `--`. ON = nothing (the sandbox
// already yolos by default via IS_SANDBOX=1); OFF forces normal prompting.
export function yoloAgentArgs(yolo: boolean): string[] {
  return yolo ? [] : ['--permission-mode', 'default']
}
```

- **`launchCommand(spec, name?, sessionName?, kitDir?, yolo = true)`** — the
  `sbx run` attach step builds `['sbx','run','--name',name]`, then the agent-arg
  tail = optional session-name args (`--name <session>`) **concatenated with**
  `yoloAgentArgs(yolo)`. Emit the `--` separator once, only when that tail is
  non-empty. So: ON + no session → `sbx run --name <name>` (unchanged); OFF →
  `… -- --permission-mode default`; ON + session → `… -- --name '<session>'`
  (unchanged); OFF + session → `… -- --name '<session>' --permission-mode default`.
- **`agentAttachCommand(name, yolo = true)`** — ON →
  `sbx run --name <name> -- --continue` (unchanged); OFF →
  `sbx run --name <name> -- --continue --permission-mode default`.

`yolo` is **optional, default `true`** on both, so `rebuild` and every existing
caller/test keep today's behavior; the UI passes an explicit value.

### IPC — `src/main/ipc.ts` + `src/renderer/ipc/client.ts`
- `instance:launch(definitionId, name?, sessionName?, opener?, yolo)` — add `yolo: boolean`.
- `instance:attach(name, opener?, yolo)` — add `yolo: boolean`.
- `instance:rebuild(name, opener?)` — **unchanged**; internally calls
  `launchDefinition(..., yolo = true)` to preserve current behavior.
- `launchDefinition(...)` gains a `yolo` parameter, forwarded to `launchCommand`.

### Renderer UI
A shared checkbox, default ON, in the three entry points:

1. **`LaunchDialog.tsx`** — `const [yolo, setYolo] = useState(true)`; a checkbox
   below the opener radios; `onLaunch(sessionName, opener, yolo)`.
2. **`OpenWithDialog.tsx`** (attach from a card) — same checkbox; `onChoose(opener, yolo)`.
3. **`TerminalsTab.tsx`** (attach via the two direct Terminal/VS Code buttons —
   no dialog) — an inline `yolo` checkbox (default ON) above the buttons; its
   value is passed to `onAttach(name, opener, yolo)`.

Wiring in `App.tsx`: `submitLaunch` and `onAttach` gain `yolo` and pass it to
`api.instanceLaunch` / `api.instanceAttach`.

Each checkbox carries a short label ("Yolo mode — skip permission prompts") and
an ⓘ tooltip (reuse the existing `title`-tooltip idiom) explaining that the
agent auto-approves actions and the sandbox is the safety boundary.

## Data flow
User ticks/unticks Yolo in the launch/attach UI → `yolo` boolean → IPC
(`instance:launch` / `instance:attach`) → `launchDefinition` / `agentAttachCommand`
→ `yoloAgentArgs` appends the Claude Code flag after `--` → sbx passes it to the
agent, which bypasses (ON) or prompts (OFF).

## Error handling / edge cases
- Re-attach uses `--continue` plus the permission flag; both are valid Claude
  Code flags together.
- `--` is emitted exactly once; a permission flag is always present so the
  separator is always needed.
- Rebuild preserves ON (no behavior change, no new prompt surface).

## Testing
- **`translate` unit tests:** `yoloAgentArgs(true)` → `[]`; `yoloAgentArgs(false)`
  → `['--permission-mode','default']`. `launchCommand(spec, name, undefined, undefined, false)`
  ends `… -- --permission-mode default`; with a session name + OFF →
  `… -- --name '<session>' --permission-mode default`. `agentAttachCommand(name, false)`
  → `… -- --continue --permission-mode default`. The existing ON-default
  assertions (no flag) stay green and must NOT be modified.
- **Dialog tests:** `LaunchDialog` / `OpenWithDialog` render the Yolo checkbox
  checked by default; unticking and confirming passes `yolo:false` to the
  callback; default confirm passes `yolo:true`. `TerminalsTab`: the inline
  checkbox defaults on and its value reaches `onAttach`.
- **Live sanity check (user, one-time, manual):** launch with Yolo OFF and
  confirm the agent now asks for permission; launch with Yolo ON and confirm it
  does not. Documented because whether Claude Code honors the OFF flag is a
  claude/sbx runtime contract, not something a unit test can assert.

## Out of scope (YAGNI)
- Persisting the choice on the definition (explicitly chosen against — per-action).
- A Yolo choice on `instance:rebuild` (stays ON).
- Finer permission modes (`acceptEdits`, `plan`) — only ON/OFF (bypass vs default).
