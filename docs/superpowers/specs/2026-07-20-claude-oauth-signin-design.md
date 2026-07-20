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

Spike findings (2026-07-20 — fully verified with a real login as a Claude Team user):

- `sbx run claude . -- login` **creates a real sandbox and starts Claude**; with
  no interactive TTY it dies on `context deadline exceeded`. OAuth therefore
  **requires a real interactive terminal** — which fits the app's existing
  native-Terminal.app architecture (osascript behind `terminal.ts`).
- The **canonical trigger is the interactive `/login` slash command inside the
  running Claude session**, not a CLI argument. The login terminal opens a normal
  Claude session; the user types `/login`; a browser completes the OAuth.
- **The token lands at `(global)` scope, host-side.** After a successful `/login`,
  `sbx secret ls -g` shows exactly one new row:
  `(global)  service  anthropic  (oauth configured)`. So: **sign in once, reused
  by every sandbox.** Removed with `sbx secret rm -g anthropic -f`.
- **The real token never enters the sandbox** (verified by inspecting the VM):
  `~/.claude/.credentials.json` inside the sandbox holds only sentinels —
  `"accessToken":"sk-ant-oat01-proxy-managed"`,
  `"refreshToken":"sk-ant-ort01-proxy-managed"`. The proxy substitutes the real
  token host-side on outbound requests.
- **The OAuth flow needs specific domains allowlisted, or it 403s.** A bare
  `sbx run claude` (default `claude` kit) allows only `claude.com`,
  `downloads.claude.ai`, `mcp-proxy.anthropic.com`. The token-exchange step calls
  **`api.anthropic.com`** and **`platform.claude.com`**, which default-deny blocks →
  Claude shows `OAuth error: Request failed with status code 403`. The login
  succeeds once those two (plus `console.anthropic.com`) are allowed on the sandbox.
- There is **no** pure headless anthropic OAuth command (the `sbx secret set
  --oauth` flag is OpenAI-only).

**Consequences that shape the design:**
1. Even launching with *no* credential is itself a sign-in opportunity — Claude
   auto-offers `/login` in-session and the resulting token persists globally. The
   launch-time gate is therefore an honest, non-blocking nudge, not a hard block.
2. **Any sandbox where the user will `/login` must allowlist the OAuth
   token-exchange domains** (`api.anthropic.com`, `platform.claude.com`,
   `console.anthropic.com`) — otherwise the sign-in 403s. This applies to the
   ephemeral Settings login sandbox AND to a normal definition launch where the
   user signs in in-session. The app's `KNOWN_SERVICES` anthropic entry is
   currently missing `platform.claude.com` and `claude.com` and must be updated so
   the generated allowlist kit covers OAuth (see Task in the plan).

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

- `oauth`  — a global anthropic row whose SECRET column reads `(oauth configured)`.
- `apikey` — a global anthropic row whose SECRET is a masked key (e.g. `sk-ant…`).
- `none`   — no global anthropic row.

Verified `sbx secret ls -g` output after a real OAuth login:

```
SCOPE      TYPE      NAME        SECRET
(global)   service   anthropic   (oauth configured)
```

The parser keys on the `anthropic` row: SECRET containing `oauth` → `oauth`;
otherwise (a masked value) → `apikey`; row absent → `none`. The adapter runs
`sbx secret ls -g` and passes stdout to the pure parser. Detection at the
**definition** launch gate also counts a definition-level anthropic service
credential as "has a credential" (so the nudge is skipped when the user already
pasted a key).

### B. Settings → Accounts (one-time global sign-in)

A new **Accounts** section in the Settings screen (sibling of Global Secrets):

- Row: **Claude Code** — status pill *Signed in (OAuth)* / *Not signed in*.
- **Sign in** → opens a native terminal running an **ephemeral login session**:
  `sbx run claude <tmp-login-dir> --name sbx-login-<n> --kit <oauth-login-kit>`.
  The **login kit must allowlist the OAuth domains** — `api.anthropic.com`,
  `platform.claude.com`, `console.anthropic.com`, `claude.com`,
  `downloads.claude.ai` — or the sign-in 403s (spike-verified). The UI shows a
  short instruction: *"In the Claude window, type `/login` and complete the
  browser sign-in, then type `/exit`."* On window refocus the app re-checks
  `auth:status` and updates the pill. The ephemeral login sandbox is removed
  afterward (best-effort `sbx rm`); the global token persists.
- **Sign out** → `sbx secret rm -g anthropic -f`, then re-check status.

> The login kit is a tiny generated mixin (reusing `src/main/kit/generate.ts`)
> whose `allowedDomains` is exactly the OAuth set above. Alternative considered:
> create the sandbox then `sbx policy allow network` each domain before the user
> types `/login` — rejected because the create→run happens in one terminal chain,
> so a kit is cleaner and race-free.

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

**Allowlist baseline for the Claude agent (spike-driven, required for this path).**
The app *always* launches the `claude` agent, yet today the generated kit only
adds Anthropic domains when an anthropic **credential** is configured. That means
a no-credential, locked/balanced definition can't even reach `api.anthropic.com`
(inference) or the OAuth endpoints — so "Launch — sign in when it opens" would
403 exactly like the spike. Fix: `src/main/kit/generate.ts` always includes the
Claude agent baseline in `allowedDomains`, independent of credentials:

```
api.anthropic.com, console.anthropic.com, claude.ai,
platform.claude.com, claude.com, downloads.claude.ai, mcp-proxy.anthropic.com
```

This makes every Claude sandbox functional under either auth method and is a
prerequisite for the in-session OAuth nudge. (The `open` tier already allows `**`;
this only affects `locked`/`balanced`.)

### D. Interfaces

- **Adapter** (`src/main/sbx/adapter.ts`): `listGlobalSecretsRaw(): Promise<string>`
  (or reuse an existing secret-ls path) and `removeSecret('anthropic', { global: true })`
  (already exists) for sign-out.
- **Login command** built in `src/main/sbx/translate.ts`:
  `loginCommand(tmpDir, name, kitDir): string` → `sbx run claude <tmpDir> --name
  <name> --kit <kitDir>`, where `kitDir` is a generated OAuth login kit
  (§B). osascript stays behind `terminal.ts` (single choke-point).
- **Kit baseline** (`src/main/kit/generate.ts`): the Claude agent domain set is
  always merged into `allowedDomains` (§C), and a small helper builds the standalone
  OAuth login kit for the Settings flow.
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
- **Unit — kit baseline**: `buildKitSpec` for a locked/balanced Claude definition
  with **no** anthropic credential still allowlists `api.anthropic.com` and
  `platform.claude.com` (regression guard for the 403).
- **Renderer — Settings Accounts**: renders status pill; **Sign in** calls
  `auth:startLogin`; **Sign out** calls `auth:signOut` and re-checks.
- **Renderer — launch nudge**: shown only when unauthenticated; each button routes
  correctly (launch / startLogin / open Credentials).

## Phase 0 spike — DONE (2026-07-20)

Completed with a real login as a Claude Team user. All questions resolved:

1. ✅ `/login` in a terminal Claude session completes OAuth after the token-exchange
   domains are allowlisted.
2. ✅ `sbx secret ls -g` → `(global) service anthropic (oauth configured)` — the
   detection marker for `parseClaudeAuth`.
3. ✅ Token is **global** and **never in the VM** — in-sandbox
   `~/.claude/.credentials.json` holds only `sk-ant-oat01-proxy-managed` /
   `sk-ant-ort01-proxy-managed` sentinels.
4. ✅ OAuth 403s without `api.anthropic.com` + `platform.claude.com` allowlisted;
   succeeds once allowed → drives the allowlist-baseline change (§C) and the login
   kit (§B).
5. ✅ Sign-out: `sbx secret rm -g anthropic -f` (deferred confirm to implementation,
   low risk).

No open spike items remain; implementation can proceed.
