# Claude Code OAuth Sign-In — Design

**Status:** Approved (brainstorm) — pending spec review
**Date:** 2026-07-20
**Scope:** Anthropic / Claude Code only (the only agent the app launches today)

## Problem

When a user creates a sandbox definition but does **not** configure a service
API key (e.g. `ANTHROPIC_API_KEY`), the app gives no signal about how the agent
will authenticate. Docker Sandboxes supports a host-side OAuth sign-in for Claude
Code, but the app neither surfaces it nor lets the user sign in ahead of time.

We want the user to be able to **log in with their own Anthropic account** — a
host-side OAuth flow whose token never enters the sandbox — both as a one-time
setup and as a nudge at launch when no credential exists.

## Grounding: how Claude OAuth actually works (verified)

From Docker's docs (get-started → "Authenticate your agent"), verbatim:

> "For Claude Code with a Claude subscription (Max, Team, or Enterprise), no
> upfront setup is needed — use the `/login` command inside the sandbox to sign
> in with OAuth. The session token stays on your host and is never stored inside
> the sandbox."

Spike findings (2026-07-20):

- `sbx run claude . -- login` **creates a real sandbox and starts Claude**; with
  no interactive TTY it dies on `context deadline exceeded`. OAuth therefore
  **requires a real interactive terminal** — which fits the app's existing
  native-Terminal.app architecture (osascript behind `terminal.ts`).
- The **canonical trigger is the interactive `/login` slash command inside the
  running Claude session**, not a CLI argument. The login terminal opens a normal
  Claude session; the user types `/login`; a browser completes the OAuth.
- The OAuth token is stored at **global** scope on the host — `sbx secret import`
  help notes anthropic OAuth "takes precedence at runtime" and is removed with
  `sbx secret rm -g anthropic`. So: **sign in once, reused by every sandbox.**
- There is **no** pure headless anthropic OAuth command (the `sbx secret set
  --oauth` flag is OpenAI-only).

**Consequence that shapes the UX:** even launching with *no* credential is itself
a sign-in opportunity — Claude auto-offers `/login` in-session and the resulting
token persists globally. The launch-time gate is therefore an honest, non-blocking
nudge, not a hard block.

## Non-goals (YAGNI)

- OAuth for other agents (OpenAI/Codex, Cursor, Droid, Gemini). The app only
  launches `claude` today. The design keeps a seam for later, but ships Anthropic-only.
- A headless / in-app OAuth flow. sbx requires a terminal; we use one.
- Managing Claude *subscription* state or plan detection.

## Architecture

Three cooperating pieces, plus detection:

### A. Auth detection (`src/main/auth/status.ts`)

A **pure parser** turns `sbx secret ls -g` output into a Claude auth state:

```ts
export type ClaudeAuthKind = 'oauth' | 'apikey' | 'none'
export interface AuthStatus { anthropic: ClaudeAuthKind }
export function parseClaudeAuth(secretLsGlobalStdout: string): ClaudeAuthKind
```

- `oauth`  — a global anthropic OAuth entry is present.
- `apikey` — a global anthropic API-key secret is present (no OAuth).
- `none`   — neither.

The adapter runs `sbx secret ls -g` (adding `--json` if the installed sbx supports
it; otherwise the text table is parsed). Detection at the **definition** launch
gate also counts a definition-level anthropic service credential as "has a
credential" (so the nudge is skipped when the user already pasted a key).

> **Spike-dependent (Phase 0):** the exact way an OAuth entry appears in
> `sbx secret ls -g` (its TYPE / label column) must be confirmed with a real
> login (needs the user's Anthropic account). If OAuth proves undetectable via
> `secret ls`, fall back to a persisted "signed in at <time>" marker written when
> the user completes the Settings flow, and treat the nudge as dismissible.

### B. Settings → Accounts (one-time global sign-in)

A new **Accounts** section in the Settings screen (sibling of Global Secrets):

- Row: **Claude Code** — status pill *Signed in (OAuth)* / *Not signed in*.
- **Sign in** → opens a native terminal running an **ephemeral login session**:
  `sbx run claude <tmp-login-dir> --name sbx-login-<n>`. The UI shows a short
  instruction: *"In the Claude window, type `/login` and complete the browser
  sign-in, then type `/exit`."* On window refocus the app re-checks `auth:status`
  and updates the pill. The ephemeral login sandbox is removed afterward
  (best-effort `sbx rm`); the global token persists.
- **Sign out** → `sbx secret rm -g anthropic -f`, then re-check status.

### C. Launch-time gate (non-blocking nudge)

Before opening the launch terminal for a definition, the app checks Claude auth.
If the definition has **no** anthropic credential **and** global status is `none`,
show a dialog:

- **Launch — sign in when it opens** (default): proceed with the normal launch;
  the user runs `/login` inside the session; the token is saved globally for next
  time.
- **Sign in first**: run the Settings login flow, then the user relaunches.
- **Use an API key instead**: open the definition's Credentials step.

If a credential/token exists, launch proceeds silently (today's behavior).

### D. Interfaces

- **Adapter** (`src/main/sbx/adapter.ts`): `listGlobalSecretsRaw(): Promise<string>`
  (or reuse an existing secret-ls path) and `removeSecret('anthropic', { global: true })`
  (already exists) for sign-out.
- **Login command** built in `src/main/sbx/translate.ts`:
  `loginCommand(tmpDir, name): string` → `sbx run claude <tmpDir> --name <name>`.
  osascript stays behind `terminal.ts` (single choke-point).
- **IPC** (`src/main/ipc.ts` + preload + renderer client):
  - `auth:status()` → `Result<AuthStatus>`
  - `auth:startLogin()` → `Result<{ name: string }>` (opens the login terminal)
  - `auth:signOut()` → `Result<null>`
- **Renderer**: a `useAuthStatus()` hook (fetch on mount + on window focus), the
  Settings Accounts section, and a launch pre-check hooked into the existing
  launch path (App / LaunchDialog).

## Data flow

```
Settings "Sign in"  → auth:startLogin → terminal.ts opens `sbx run claude <tmp> --name sbx-login`
                    → user runs /login in Claude → browser OAuth → global token on host
                    → window refocus → auth:status → parseClaudeAuth(`sbx secret ls -g`) → pill = Signed in

Launch definition   → auth:status + definition creds → if none: nudge dialog
                    → "Launch": normal launchDefinition() (user may /login in-session)
                    → "Sign in first": auth:startLogin
                    → "Use an API key": open Credentials step
```

## Error handling

- `sbx secret ls -g` failure → status resolves to `none` (fail-open to the nudge)
  and the error is logged; the app never blocks on a detection failure.
- Login terminal open failure → surfaced as a toast/error in Settings; no state change.
- Sign-out failure → error surfaced; status re-checked so the UI reflects reality.
- Ephemeral login-sandbox cleanup is best-effort and logged; a leftover login
  sandbox is harmless and user-removable.

## Testing

- **Unit — `parseClaudeAuth`**: oauth row → `oauth`; api-key row → `apikey`;
  empty / unrelated → `none`; malformed input → `none`.
- **Unit — `loginCommand`**: emits `sbx run claude <tmp> --name <name>`; token
  never appears (there is none on the command line).
- **Unit — gate decision**: `none` + no definition cred → nudge; `oauth`/`apikey`
  or definition cred present → no nudge.
- **Renderer — Settings Accounts**: renders status pill; **Sign in** calls
  `auth:startLogin`; **Sign out** calls `auth:signOut` and re-checks.
- **Renderer — launch nudge**: shown only when unauthenticated; each button routes
  correctly (launch / startLogin / open Credentials).

## Phase 0 spike (before implementation)

Needs the user's real Anthropic account (the assistant cannot complete an OAuth):

1. Run `sbx run claude <tmp>` in a terminal, do `/login`, complete OAuth.
2. Inspect `sbx secret ls` and `sbx secret ls -g` — capture how the anthropic
   OAuth entry appears (scope, TYPE, label) to finalize `parseClaudeAuth`.
3. Confirm the token is **global** (a second, unrelated sandbox launches
   authenticated without a key).
4. Confirm `sbx secret rm -g anthropic -f` clears it (sign-out).

The spike result confirms/adjusts the detection parser and the sign-out command;
everything else in the design is independent of it.
