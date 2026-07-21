# "Open in VS Code" Launch Option — Design

**Status:** Approved (brainstorm) — pending spec review
**Date:** 2026-07-21
**Scope:** A per-launch choice to open a sandbox session in VS Code (folder + integrated terminal) instead of Terminal.app, so the user sees the agent's file changes live. Applies to Launch and Attach/Open-Agent-Session.

## Problem

Launching a sandbox opens the interactive agent session in **Terminal.app**. The user
can't see the files the coding agent is editing. They want an alternative: open **VS
Code** on the working directory (file explorer shows live changes) with the agent
session running in VS Code's integrated terminal.

## Grounding (verified)

- The `code` CLI is installed (`/usr/local/bin/code`, v1.128.0). Detected per-run.
- **sbx has no VS Code / editor / attach integration** — no relevant subcommand. This
  is entirely app-side.
- In **direct** mount mode the host working directory *is* the sandbox's workspace
  (bind mount), so opening VS Code on the host folder shows the agent's edits live.
  In **clone** mode the agent works on an in-container copy (reachable via the
  `sandbox-<name>` git remote); the host folder does NOT reflect its edits.
- VS Code's integrated terminal is a real PTY, so the interactive `sbx create → run`
  chain runs there exactly as in Terminal.app.
- There is **no** `code` CLI flag to run a command in the integrated terminal. The
  supported way to auto-run one on open is a **task with `runOptions.runOn:
  "folderOpen"`**, which VS Code executes in a trusted workspace with automatic tasks
  allowed.

## Non-goals (YAGNI)

- Editors other than VS Code (no Cursor/JetBrains/etc.).
- A VS Code extension, Dev Containers, or Remote-SSH attach into the sandbox VM.
- Persisting the opener choice per-definition or globally — it is a per-launch choice.
- Making clone-mode changes visible on the host (out of scope; noted as a caveat).

## Architecture

### A. The choice (renderer)

`LaunchDialog` gains an **Open with** control: `Terminal` (default) / `VS Code`.
- The VS Code radio is **disabled with a hint** when `code` isn't installed
  (from a `env:hasVSCode` check fetched when the dialog opens).
- When the definition's primary mount is **clone** mode, a subtle note explains VS
  Code shows the host copy, not the agent's in-container clone.
- The chosen `opener: 'terminal' | 'vscode'` is passed to `instance:launch`.

The same **Open with** choice is offered for **Attach / Open Agent Session**
(Instances list + Instance Detail). Because those entry points are buttons (no
dialog today), attach routes the opener through a small dialog or an inline
two-option control; v1 reuses a minimal "Open with" prompt before opening. (Detail
in the plan; the renderer decision is: attach passes `opener` to `instance:attach`.)

### B. VS Code opener mechanism (main)

New choke point `src/main/vscode.ts`, parallel to `terminal.ts`:

```ts
export function codeCliPresent(spawnSync?: …): boolean            // `code --version` succeeds
export function openInVSCode(workspaceFile: string, spawn?): void  // spawns `code <file>`
```

A pure generator builds the throwaway VS Code **workspace file** (kept in the
already-gitignored `.sandbox/` dir — never the user's `.vscode/`):

```ts
// src/main/vscode/workspace.ts
export function buildCodeWorkspace(workspaceDir: string, sandboxName: string, command: string): string // JSON
```

produces:
```jsonc
{
  "folders": [{ "path": "<abs workspace>" }],
  "tasks": { "version": "2.0.0", "tasks": [{
    "label": "AI Sandbox: <name>", "type": "shell",
    "command": "<the sbx chain>",
    "runOptions": { "runOn": "folderOpen" },
    "presentation": { "panel": "dedicated", "focus": true },
    "problemMatcher": []
  }]}
}
```

The main process writes it to `<workspaceDir>/.sandbox/<name>.code-workspace` (reusing
the existing kit `fs` helper + `.sandbox` gitignore) and spawns `code <file>`.

### C. Launch wiring (main)

`launchDefinition` gains `opener: 'terminal' | 'vscode'` (default `'terminal'`) and a
new dep `openVSCode(command, workspaceDir, sandboxName)`. After building `command`
and resolving the primary mount's `hostPath` (the workspace dir):

- `opener === 'vscode'` **and** a workspace dir exists **and** `code` is present →
  write the workspace file and `openVSCode(...)`.
- otherwise → `openTerminal(command)` (today's path; also the fallback if VS Code
  can't be used).

Instance metadata + credential registration are unchanged.

### D. Attach / Open Agent Session (main)

`instance:attach` gains `opener`. When `'vscode'`: resolve the instance's workspace
dir (via `instance_meta.definitionId → getDefinitionSpec → primary mount hostPath`;
if unlinked, fall back to Terminal), build a workspace file whose task runs
`agentAttachCommand(name)`, and open VS Code. `instance:shell` stays Terminal-only
(a host shell has no workspace to show); it may adopt the opener later.

### E. Interfaces

- IPC: `instance:launch(defId, name?, sessionName?, opener?)`, `instance:attach(name, opener?)`, and `env:hasVSCode() → Result<{ present: boolean }>`. Preload + client updated.
- `launchDefinition` deps: add `openVSCode(command, workspaceDir, name)` and param `opener`.
- `src/main/vscode.ts`: `codeCliPresent`, `openInVSCode`. `src/main/vscode/workspace.ts`: `buildCodeWorkspace`.
- `index.ts` wires `openVSCode` (writes the workspace file via the kit `fs`, spawns `code`) and a `hasVSCode` probe.
- Renderer: `LaunchDialog` opener toggle + clone-mode note; attach opener prompt; `useEffect` fetch of `env:hasVSCode`.

### F. Data flow

```
Launch dialog (Open with: VS Code) → instance:launch(…, opener:'vscode')
  → launchDefinition builds sbx chain + resolves workspace dir
  → buildCodeWorkspace(dir, name, chain) → write .sandbox/<name>.code-workspace
  → openVSCode: spawn `code <file>`
  → VS Code opens folder (files visible) + folderOpen task runs sbx chain in integrated terminal (real PTY)
  → agent session runs in VS Code; edits appear live in the explorer (direct mount)
```

## Error handling

- `code` missing at launch (race with the disabled toggle) → fall back to Terminal.app and log a notice; never fail the launch.
- No workspace dir resolvable (unlinked instance / empty mount) → fall back to Terminal.app.
- Workspace-file write failure → fall back to Terminal.app, log the error.
- VS Code automatic tasks disabled/untrusted → the task doesn't auto-fire; VS Code still opens on the folder and the task is one click away (Run Task → "AI Sandbox: <name>"). Non-fatal; documented in the dialog note.

## Testing

- **Unit — `buildCodeWorkspace`**: emits valid JSON with the abs folder path, the exact task command, and `runOn: folderOpen`; contains no secret (there are none on the chain).
- **Unit — opener selection in `launchDefinition`**: `opener:'vscode'` with a workspace dir + `openVSCode` dep → calls `openVSCode`, not `openTerminal`; `opener:'terminal'` (or no workspace / VS Code unavailable) → `openTerminal`. Verify the sbx chain string is identical either way.
- **Unit — `codeCliPresent`**: true/false from an injected spawn result.
- **Unit — attach opener**: `instance:attach(name,'vscode')` resolves the workspace and builds an attach-command workspace file; unlinked instance falls back to Terminal.
- **Renderer — `LaunchDialog`**: renders the Open-with toggle; VS Code disabled when `hasVSCode` false; clone-mode note shown for clone primary mount; passes the chosen opener on launch.

## Phase 0 spike (before implementation)

On this machine (quick, no account needed):
1. Write a `.code-workspace` with a `folderOpen` shell task that runs a trivial
   command; `code <file>`; confirm the task auto-runs in an integrated terminal
   (note the trust / "allow automatic tasks" prompt behavior).
2. Confirm `sbx run --name <scratch>` works in a VS Code integrated terminal (real
   TTY) and that edits from within show up in the explorer under direct mount.
3. If auto-tasks prove unreliable, switch mechanism to the **hybrid fallback**
   (open the folder with `code <dir>` + run the sbx chain in Terminal.app) and
   update §B accordingly. Everything else in the design is mechanism-independent.
