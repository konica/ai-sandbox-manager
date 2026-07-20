# SSH Agent Forwarding & Commit Signing — Design

**Status:** Approved (brainstorm) — pending spec review
**Date:** 2026-07-20
**Scope:** Add an "SSH Agent" tab to the Credentials step (per v9 mockup) with two per-definition toggles — Forward SSH Agent and Automatic Commit Signing — plus their launch-time effects.

## Problem

Developers need Git-over-SSH and SSH-based commit signing inside the sandbox
without their private key ever entering it. Docker Sandboxes supports this, but
the app neither surfaces it nor lets the user configure commit signing.

## Grounding: how it works (verified against Docker docs)

- **SSH agent forwarding is automatic.** Verbatim: *"If your host has an SSH agent
  and `SSH_AUTH_SOCK` is set, Docker Sandboxes forwards the agent into the sandbox
  and sets `SSH_AUTH_SOCK` there. The private keys stay on your host."* There is
  **no `sbx` flag** for it (confirmed: `sbx run`/`sbx create --help` have none).
  Our launch runs in Terminal.app (a login shell) which already inherits
  `SSH_AUTH_SOCK`, so forwarding works today.
- **To NOT forward**, the launching shell must not have `SSH_AUTH_SOCK` set →
  prepend `unset SSH_AUTH_SOCK; ` to the launch command.
- **Commit signing** = run inside the sandbox (verbatim from the workflows doc):
  ```
  git config --global gpg.format ssh
  git config --global user.signingkey "key::$(ssh-add -L | head -n 1)"
  ```
  then `git commit -S`. The `$(ssh-add -L …)` must execute **inside** the sandbox
  (it queries the forwarded agent). Commit signing therefore **requires forwarding**.
- **Outbound SSH is still subject to network policy** (informational; no change here —
  Git hosts like github.com are already reachable via the balanced tier / user domains).

## Non-goals (YAGNI)

- Choosing *which* key — uses the host agent's first key (`ssh-add -L | head -n 1`), per docs.
- The external `git-ssh-sign` community kit — we inline the two documented commands instead (no external dependency).
- SSH for non-Git use, or managing host `ssh-add`.

## Architecture

### A. Data model

Add to `src/shared/types.ts`:

```ts
export interface SshConfig { forwardAgent: boolean; commitSigning: boolean }
// DefinitionSpec gains:  ssh: SshConfig
```

Default `{ forwardAgent: true, commitSigning: false }`. **Invariant:** `commitSigning`
is only ever `true` when `forwardAgent` is `true` (enforced in the wizard and in `toSpec`).

Persisted on the `definition` table via a **v5 → v6** non-destructive migration
(`ALTER TABLE definition ADD COLUMN ssh_forward_agent INTEGER NOT NULL DEFAULT 1`,
`ssh_commit_signing INTEGER NOT NULL DEFAULT 0`). Reader coerces `1/0` → boolean.

The draft (`src/renderer/wizard/draft.ts`) carries `sshForwardAgent: boolean` and
`sshCommitSigning: boolean`; `toSpec` maps them into `ssh` (forcing signing off when
forwarding off); `draftFromSpec` reverses it.

### B. Credentials step — new "SSH Agent" tab

`src/renderer/wizard/CredentialsStep.tsx` gains a fourth tab (after Registry). It is
NOT a credential-list tab; it edits the draft's two SSH flags directly, so the step
needs new props: `ssh: { forwardAgent, commitSigning }`, `onSshChange(next)`, and
`sshDetected: boolean`.

- **Forward SSH Agent** toggle (default on). Below it a detection line:
  green dot + "SSH agent detected (`SSH_AUTH_SOCK` is set)" when `sshDetected`, else
  grey dot + "No SSH agent detected on the host".
- **Automatic Commit Signing** toggle (default off). **Disabled when Forward is off**;
  turning Forward off also forces signing off. Explanatory sub-text from the mockup.
- "How it works" + security notes (from the mockup).

Because the existing tab UI is credential-list-oriented, the SSH tab renders its own
switch rows (reusing existing button/label styling; a simple checkbox styled as a
switch is acceptable — the test keys on the accessible label, not the visuals).

### C. Launch integration

`src/main/sbx/translate.ts` — `launchCommand(spec, …)` consumes `spec.ssh`:

- **Forward off** (`spec.ssh.forwardAgent === false`): prepend `unset SSH_AUTH_SOCK; `
  to the whole chain (so neither create nor run forwards the agent).
- **Commit signing on** (`spec.ssh.commitSigning === true`): insert a signing step
  immediately after `sbx create`, before ports/run:
  ```
  sbx exec <name> bash -lc 'git config --global gpg.format ssh && git config --global user.signingkey "key::$(ssh-add -L | head -n 1)"'
  ```
  Built via a new helper `commitSigningExecCommand(name)` so the exact string is
  unit-tested. The single-quoted body keeps `$(…)` from expanding on the host; it runs
  in the sandbox's bash against the forwarded agent.

Resulting chain (signing on, forward on):
`sbx create … && sbx exec <name> bash -lc '…' && sbx ports … && sbx run …`

Resulting chain (forward off): `unset SSH_AUTH_SOCK; sbx create … && sbx ports … && sbx run …`
(signing is guaranteed off when forward is off, so the two never combine badly.)

### D. Detection IPC

- **Main** (`src/main/ipc.ts`): `ssh:detect()` → `Result<{ present: boolean }>`,
  reading `deps.readLoginEnv?.().SSH_AUTH_SOCK` (helper already exists in `index.ts`
  and is passed into Deps). A pure helper `sshAuthSockPresent(env)` in a small module
  (`src/main/ssh/detect.ts`) is unit-tested; the handler calls it.
- **Preload + renderer client**: `sshDetect()`.
- The wizard calls `api.sshDetect()` on mount of the Credentials step and passes the
  result into `CredentialsStep` as `sshDetected`.

### E. Review + Detail display

- **Review step** (`CreateDefinition.tsx`): an "SSH Agent" row — value "Forwarded" or
  "Off"; append " + commit signing" when signing on.
- **Instance Detail** (`TerminalsTab.tsx`): one line in the Credentials card —
  "SSH Agent: Forwarded" / "Off", with "· commit signing" when on. Read from the spec.

### F. Interfaces (summary)

- `SshConfig` in `@shared/types`; `DefinitionSpec.ssh`.
- `commitSigningExecCommand(name: string): string` and updated `launchCommand` in `translate.ts`.
- `sshAuthSockPresent(env: Record<string,string|undefined>): boolean` in `src/main/ssh/detect.ts`.
- IPC `ssh:detect`; preload `sshDetect`; client `sshDetect()`.
- Draft: `sshForwardAgent`, `sshCommitSigning` + reducer actions `setSshForward`, `setSshCommitSigning`.
- `CredentialsStep` new props: `ssh`, `onSshChange`, `sshDetected`.

## Error handling

- `ssh:detect` failure → `{ present: false }` (fail closed to "not detected"); the
  toggle still works (detection is advisory only).
- If commit signing is on but the host agent has no key, the in-sandbox
  `ssh-add -L` yields empty and `git config user.signingkey` gets `key::` — a benign
  misconfig the user sees on first `git commit -S`. We surface the dependency in the
  UI (signing requires forwarding) but do not block launch on host key presence.
- Launch command construction is pure/tested; a malformed spec can't inject shell
  (name is `toSbxName`-validated; the signing body is a fixed literal).

## Testing

- **Unit — `launchCommand`**: (a) default (forward on, signing off) → unchanged vs
  today; (b) forward off → chain starts with `unset SSH_AUTH_SOCK; `; (c) signing on →
  contains the exact `sbx exec <name> bash -lc 'git config --global gpg.format ssh && git config --global user.signingkey "key::$(ssh-add -L | head -n 1)"'` immediately after create; (d) signing never present when forward off.
- **Unit — `commitSigningExecCommand`**: exact string; name is quoted safely.
- **Unit — `sshAuthSockPresent`**: set/empty/undefined.
- **Unit — draft**: `toSpec` forces signing off when forward off; round-trips both flags via `draftFromSpec`.
- **Unit — DB**: definition round-trip persists both flags; migration adds columns to an existing DB without data loss.
- **Unit — ipc**: `ssh:detect` returns present/absent from injected `readLoginEnv`.
- **Renderer — CredentialsStep**: SSH tab shows detection status; toggling Forward off disables + clears signing; toggles call `onSshChange` with the right shape.
- **Renderer — Review**: shows the SSH row for forwarded / off / +signing.

## Phase 0 spike (before implementation)

Low-risk; mechanics are documented. One optional confirmation during implementation
(no user account needed): verify in a scratch sandbox that
`sbx exec <name> bash -lc 'ssh-add -L'` sees the forwarded key, and that
`unset SSH_AUTH_SOCK; sbx run …` yields no `SSH_AUTH_SOCK` in-sandbox. Everything
else is grounded in the docs.
