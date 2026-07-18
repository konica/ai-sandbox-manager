---
id: arch-local-sandbox-manager-for-coding-agents-001
featureId: feat-local-sandbox-manager-for-coding-agents
stage: architecture
status: draft
stale: false
title: Local Sandbox Manager for Coding Agents architecture
dependsOn:
  - prd-local-sandbox-manager-for-coding-agents-001
basedOn:
  prd-local-sandbox-manager-for-coding-agents-001: 2
generatedBy: agent
version: 1
createdAt: '2026-07-17T21:39:38.805Z'
updatedAt: '2026-07-17T21:39:38.805Z'
---
> Based on PRD `prd-local-sandbox-manager-for-coding-agents-001` (v2, approved) and the design mockups at `design/mockup/AI Sandbox Manager/index.html` + `DESIGN-HANDOFF.md` + `DESIGN-MANIFEST.json` (on-disk export, not a SpecManager design-stage doc). Stack choices were confirmed by the user in an architecture brainstorm; rationale is inline per decision.

## Summary

A local, single-user **Electron desktop app** that is a control-plane GUI over the Docker Sandboxes CLI (`sbx`). It turns "which folders, what permissions, what hosts, what credentials" into running, monitorable, PTY-interactive Claude Code sandboxes without the user ever typing an `sbx` command. The app builds **nothing** for isolation itself — all isolation, egress enforcement, and credential injection are delegated to `sbx`; the app only composes `sbx` invocations, streams two PTYs into the UI, and keeps a thin local metadata store reconciled against `sbx` (which stays the source of truth for sandbox existence and state). Greenfield repo: everything below is new. The design export is a single vanilla HTML/CSS/JS screen with five in-app views (prereq, dashboard, create wizard, detail, settings) that we port to React while preserving its dark-theme tokens.

## Tech stack (confirmed) & rationale

| Layer | Choice | Rationale |
|---|---|---|
| App shell | **Electron** (Node main process + bundled Chromium renderer) | The two hard parts — PTY bridging and OS-keychain access — have the most batteries-included Node path (`node-pty`, `keytar`); the mockup is already browser-rendered HTML so the renderer maps 1:1. Satisfies PRD "local web server + browser-rendered UI, no separate server component" (§Goals). |
| Renderer UI | **React + Vite + TypeScript** | Largest ecosystem for `xterm.js` + state; matches Electron-renderer norms. |
| Terminals | **xterm.js** (renderer) ⇄ **node-pty** (main) | Documented interactive path; renders both PTYs natively in-app (PRD §Goals: "no external terminal windows"). |
| Terminal transport | **localhost WebSocket** (fallback: Electron IPC) | Binary PTY byte stream; WS keeps the renderer decoupled and matches the common xterm pattern. |
| sbx integration | **CLI shell-out only** (`child_process`) | Confirmed via Docker docs (Context7 `/docker/docs`, 2026-07 + web search): `sbx` exposes a **CLI + SSH**, no standalone SDK. Adapter prefers machine-readable/`--json` flags where present, falls back to text parsing. |
| App metadata | **better-sqlite3** | Synchronous, embedded, zero external service; holds only app-specific metadata `sbx` doesn't track. |
| Credential values | **delegated to `sbx secret set`** (stdin) | `sbx` already stores secrets in the host OS keychain and injects them via its proxy; the raw value never enters the VM. App avoids holding secret values on the primary path. |
| App-held secret material | **keytar** (OS keychain) + **AES-GCM** encrypted-file fallback | Fulfills PRD's "both OS-native store and app-managed encrypted fallback" (§Goals, §Locked-in assumptions). |

**Grounded doc lookups (R6/AC5):** Docker Sandboxes interface confirmed against Context7 `/docker/docs` (branch `main`, last update 2026-07-16) and Docker docs web search — establishing CLI-only surface, `sbx exec -it <name> bash` for interactive shells, `sbx policy allow|ls|inspect|check network`, `sbx secret set` (stdin-capable, OS-keychain-backed, `-g` global scope, `proxy-managed` injection), `--publish` port mapping, and OpenSSH-compatible remote connections. No Context7 entry added to `.mcp.json`.

## Affected components (all new — greenfield)

Proposed source layout (Electron + Vite two-process split):

```
package.json                      electron-builder + vite scripts
electron/                         MAIN process (Node)
  main.ts                         app bootstrap, window, lifecycle
  ipc/handlers.ts                 typed IPC surface exposed to renderer
  sbx/adapter.ts                  #sbx-adapter — the only place that spawns `sbx`
  sbx/parse.ts                    JSON-first, text-fallback parsers for sbx output
  sbx/reconciler.ts              #reconciler — merge sbx state ⇄ local metadata
  pty/bridge.ts                   #pty-bridge — node-pty ⇄ WebSocket server
  policy/controller.ts           #policy-controller — tier↔allowlist translation
  creds/manager.ts               #credential-manager — sbx secret + keychain/AES split
  store/db.ts                     #metadata-store — better-sqlite3 schema + queries
  prereq/detector.ts             #prereq-detector — first-run environment checks
preload.ts                        contextBridge — safe IPC allowlist
src/                              RENDERER (React)
  screens/{Prereq,Dashboard,Create,Detail,Settings}.tsx  (mockup's 5 views)
  components/Terminal.tsx         xterm.js wrapper (agent + shell instances)
  components/{PolicyEditor,CredentialForm,MountList,TrafficFeed}.tsx
  theme/tokens.css                tokens extracted from mockup :root
  ipc/client.ts                   typed wrapper over window.api
```

Design mapping: the mockup's `data-screen` values (`prereq`, `dashboard`, `create`, `detail`, `settings`) become the five `screens/*.tsx` routes; `data-od-id` regions map to components (`sandbox-table-body`→Dashboard table, `wizard-step-1..5`→Create wizard, `terminal-agent`/`terminal-shell`→two `Terminal` instances, `panel-policy-detail`/`live-domain-list`→PolicyEditor, `traffic-feed`→TrafficFeed). Tokens (`--accent:#4f8cff`, `--font-mono: JetBrains Mono`, dark surfaces, spacing scale) are frozen into `theme/tokens.css` before component work per the handoff's token-first rule.

## Data model changes

`sbx` is authoritative for sandbox existence/status/policy/secrets. The local DB (`store/db.ts`, better-sqlite3) holds **only** app-specific metadata `sbx` does not track:

| Table | Columns (sketch) | Purpose |
|---|---|---|
| `sandbox_meta` | `sbx_name` PK, `tier` (`open`\|`balanced`\|`locked`), `created_by_app` bool, `label`, `notes`, `created_at` | Per-sandbox tier label + provenance; tier is a UI concept `sbx` doesn't store, only its resulting allowlist does. |
| `mount_intent` | `id`, `sbx_name` FK, `host_path`, `mode` (`direct`\|`clone`), `is_primary` | Records the extra-folder mount intents chosen in the wizard (`sbx` reflects mounts but not the user's per-folder intent grouping). |
| `credential_link` | `id`, `sbx_name` FK, `service`/`key_name`, `store` (`sbx`\|`keychain`\|`encrypted`), `has_app_copy` bool | Association of credential → sandbox and where its value lives. **No secret value column.** |
| `app_prefs` | `key` PK, `value` | UI prefs (theme, last screen, etc.). |

**Migration notes:** single initial migration creates the schema on first launch; a `schema_version` pragma gates future migrations. No destructive migrations at MVP. Externally-created sandboxes (CLI or prior run) appear via reconciliation with **no** `sandbox_meta` row — the UI must render them gracefully with tier shown as "custom/unknown" until inferred from `sbx policy inspect`.

## Interfaces

TypeScript signatures, main-process modules. IPC is the only renderer↔main boundary; the renderer never spawns processes.

**#sbx-adapter** (`electron/sbx/adapter.ts`) — sole `sbx` spawn site:
```ts
runSbx(args: string[], opts?: { stdin?: string; json?: boolean }): Promise<SbxResult>
listSandboxes(): Promise<Sandbox[]>              // sbx ls  (JSON if available, else parse)
createSandbox(spec: CreateSpec): Promise<Sandbox> // composes sbx create/run + mounts + publish
startSandbox(name: string): Promise<void>         // sbx start
stopSandbox(name: string): Promise<void>          // sbx stop  (preserves VM/state)
removeSandbox(name: string): Promise<void>        // sbx rm    (irreversible — VM+images+pkgs)
```

**#policy-controller** (`electron/policy/controller.ts`):
```ts
type Tier = 'open' | 'balanced' | 'locked';
tierToAllowlist(tier: Tier): string[]             // maps tier → concrete domain set
applyTier(name: string, tier: Tier): Promise<void>            // sbx policy reset + allow*
addDomain(name: string, host: string): Promise<void>          // sbx policy allow network <host>
removeDomain(name: string, host: string): Promise<void>       // prune (incl. default wildcards)
inspect(name: string): Promise<{ tier: Tier|'custom'; domains: string[] }> // sbx policy inspect
```

**#credential-manager** (`electron/creds/manager.ts`):
```ts
setSecret(sc: { name?: string; service?: string; scope: 'global'|'sandbox'; value: string }): Promise<void>
  // primary path: pipes value to `sbx secret set [-g] <service>` via stdin; value never persisted by app
saveAppSecret(id: string, value: string): Promise<void>  // fallback path: keytar → AES-GCM file
getAppSecret(id: string): Promise<string | null>
listLinks(name: string): Promise<CredentialLink[]>       // from credential_link table (no values)
```

**#pty-bridge** (`electron/pty/bridge.ts`):
```ts
openAgentPty(name: string): PtySession   // attaches to the running Claude Code process in the sandbox
openShellPty(name: string): PtySession   // spawns `sbx exec -it <name> bash`
// PtySession: { id, ws: WebSocketEndpoint, write(data), resize(cols,rows), kill() }
```

**#reconciler** (`electron/sbx/reconciler.ts`):
```ts
reconcile(): Promise<SandboxView[]>  // sbx ls ⟕ sandbox_meta; flags orphan meta + app-unknown sandboxes
```

**IPC surface** (`electron/ipc/handlers.ts`, mirrored in `preload.ts` allowlist): `sbx:list|create|start|stop|remove`, `policy:inspect|applyTier|addDomain|removeDomain`, `creds:set|list|saveApp`, `pty:openAgent|openShell` (returns WS URL + token), `prereq:check`, `meta:get|set`.

## R1 — Prerequisite detection & first-run gating

Maps PRD §Constraints ("`sbx` must already be installed and authenticated") and mockup `screen-prereq` (`check-docker`, `check-sbx-cli`, `check-auth`, `check-oskeychain`, `check-disk`). `#prereq-detector` runs on launch: `docker` present, `sbx` on PATH + version, `sbx login` authenticated (probe via a read-only `sbx` call), OS keychain reachable (keytar probe → decides primary vs. AES fallback), disk headroom. App **does not install/replace** `sbx`; on failure it shows the prereq screen with remediation, never silently fails. Passing gate → route to dashboard.

## R2 — Sandbox lifecycle & list view

Maps PRD §Goals (create/start/stop/remove; list with status, workspace, agent) and mockup `screen-dashboard` (`sandbox-table-body`, per-row `data-action="start|stop|remove"`, `sandbox-empty`). List is produced by `#reconciler` (never a pure local read). **Stop vs. remove are distinct, differently-styled actions**; remove requires a confirmation modal given `sbx rm` irreversibility (VM+images+packages deleted; host workspace files never touched — surface this copy). Agent column is fixed to "Claude Code" (MVP non-goal: other agents). Previously-running sandboxes are shown in whatever state `sbx` reports; **no auto-restart** (PRD §Non-goals) — restart is a manual row action.

## R3 — Create-sandbox wizard (directories & mounts)

Maps PRD §Goals/§Flows and mockup `screen-create` 5-step wizard. Steps: (1) working directory + extra folders (`extra-folders`); (2) mount mode per folder — **direct** (read-write passthrough, same absolute path) vs **clone** (read-only) — the only two `sbx` modes; `direct-mode-warning` must warn about implicit-execution-file exposure (git hooks, CI config, Makefiles) per PRD §Constraints; (3) network tier (defaults **Locked Down**, `tier-locked` preselected); (4) credentials; (5) review & create. On create, `#sbx-adapter.createSandbox` composes the `sbx create`/`run` invocation with mounts and any `--publish`, then writes `sandbox_meta` + `mount_intent` rows. Mount intents are persisted because `sbx` reflects the mount but not the user's per-folder grouping/mode intent for later display.

## R4 — Network policy (three tiers + live allowlist editor)

Maps PRD §Goals (three-tier Open/Balanced/Locked Down per sandbox, default Locked Down; prune default wildcards) and mockup `tier-open|balanced|locked`, `panel-policy-detail`, `live-domain-list`, `domain-pending-*`, `tier-toggle-live`, `pending-requests-bar`. `#policy-controller` owns the tier→allowlist translation and applies it via `sbx policy allow network <host>` / `sbx policy reset`. **Live edits** (add/remove domain, switch tier on a running sandbox) go through the same controller without recreating the sandbox. The UI must **allow pruning** default wildcard entries (e.g. `*.googleapis.com`), not only additive edits. The UI must **not** imply raw TCP/UDP/ICMP can be allowed — HTTP/HTTPS only; those protocols are always blocked (PRD §Constraints). Tier is stored in `sandbox_meta`; on external sandboxes tier is inferred from `sbx policy inspect` or shown "custom."

## R5 — Credentials (sbx-owned values + app metadata split)

Maps PRD §Goals (route all credentials through `sbx secret set`; never bake into image or write into sandbox FS; both OS-native store and encrypted fallback) and mockup `wizard-step-4`/`panel-credentials` (`credential-list`, `btn-add-credential`). **The exact split:**

- **Secret values → `sbx secret set` (primary).** `#credential-manager.setSecret` pipes the value via **stdin** to `sbx secret set [-g] <service|name>`. `sbx` stores it in the host OS keychain and injects it via its host-side proxy (`proxy-managed`); the value never enters the VM and the app never persists it. Covers git auth, Claude Code auth, arbitrary API keys.
- **App-held secret material → keytar → AES-GCM fallback.** Only for material the app itself must hold before/without delegating (e.g. a value staged before sandbox creation, or a machine where the keychain probe passed for the app but a service isn't an `sbx` kit). Primary = OS keychain via keytar; documented fallback = AES-GCM encrypted file with an OS-derived key, used only when keytar is unavailable (decided by the R1 keychain probe).
- **App DB stores associations only** (`credential_link`) — service/key name, which store holds the value, and the sandbox link. **No value column anywhere in SQLite.**

Claude Code auth follows its real flow (in-sandbox `/login` OAuth token kept on host) — MVP builds specifically for this, no generic multi-agent abstraction (PRD §Non-goals).

## R6 — Dual PTY terminals (agent + shell)

Maps PRD §Goals ("two separate in-app terminal emulators per running sandbox") and mockup `terminal-agent`/`terminal-shell` tabs. `#pty-bridge`: **agent terminal** attaches to the already-running Claude Code process inside the sandbox; **shell terminal** spawns `sbx exec -it <name> bash` — independent, so poking the filesystem never disturbs the agent session. Each PTY runs under `node-pty` in main; bytes stream to an `xterm.js` instance in the renderer over a **localhost WebSocket** (per-session token; IPC fallback). Resize events propagate to `node-pty`. Time-to-first-interaction target is single-action from the list/detail view (PRD §Success Metrics).

## R7 — Live monitoring / traffic feed

Maps mockup `panel-monitoring` (`traffic-feed`, `log-row-allowed-*`, `log-row-blocked-*`, `blocked-count-badge`) and PRD §Goals ("where `sbx` exposes it, resource/activity signal"). The app surfaces allowed/blocked egress and a blocked-count badge **only to the extent `sbx` exposes such a feed** (policy check / logs). If no live stream exists, this degrades to on-demand `sbx policy check network` results — flagged in Open Questions. No invented telemetry.

## R8 — Persistence & launch-time reconciliation

Maps PRD §Flows ("detect pre-existing sandboxes"). On launch: `#reconciler.reconcile()` runs `sbx ls` and left-joins `sandbox_meta`. Three cases: (a) app-created + meta present → full view; (b) externally-created, no meta → shown with inferred/"custom" tier, editable; (c) orphan meta (sandbox `rm`'d outside app) → meta soft-hidden/garbage-collected. `sbx` always wins on status. The app is thus a true control surface over `sbx` state, not an app-siloed record.

## core-sbx-adapter

The single choke point for all `sbx` interaction (`electron/sbx/adapter.ts` + `parse.ts`). Every subcommand goes through `runSbx()`; nothing else in the app spawns `sbx`. Output handling is **JSON-first with text fallback**: try `--json`/machine-readable flags, parse structurally; if unsupported, fall back to tolerant text parsers isolated in `parse.ts` so format drift is contained to one module. Errors are normalized to a `SbxError` discriminated union (not-installed, not-authed, not-found, policy-rejected, generic) that the IPC layer surfaces to the UI.

## pty-bridge

Owns `node-pty` lifecycles and a localhost WebSocket server (bound to `127.0.0.1`, ephemeral port, per-session bearer token minted by main and handed to the renderer through IPC). One `PtySession` per open terminal; killed on sandbox stop/remove or tab close. Backpressure handled by pausing `node-pty` when the WS buffer is full.

## credential-manager

Implements the R5 split. Decides primary vs. fallback store from the R1 keychain probe result. Guarantees the invariant that **no secret value is ever written to SQLite or the sandbox filesystem** — enforced by construction (no value-accepting DB method exists).

## metadata-store

`better-sqlite3` wrapper: schema init, `schema_version` pragma, typed query helpers, and the reconciliation joins. Synchronous API is acceptable in the Electron main process for this data volume.

## Sequence / control flows

**Create sandbox:** Wizard (renderer) → `ipc sbx:create` → `#sbx-adapter.createSandbox` composes `sbx create/run` (+ mounts, `--publish`) → on success `#policy-controller.applyTier` (default Locked Down) → `#credential-manager.setSecret` per credential (stdin → `sbx secret set`) → write `sandbox_meta` + `mount_intent` + `credential_link` → return `Sandbox` → dashboard refresh via `#reconciler`.

**Attach terminals:** Detail view opens → `ipc pty:openAgent` and/or `pty:openShell` → `#pty-bridge` spawns/attaches `node-pty` (`sbx exec -it … bash` for shell; attach to Claude Code proc for agent) → returns `{ wsUrl, token }` → renderer `Terminal.tsx` connects `xterm.js` to WS → bidirectional byte + resize stream.

**Live policy edit:** PolicyEditor add/remove domain or tier switch → `ipc policy:*` → `#policy-controller` → `sbx policy allow/reset` → re-`inspect` → update `sandbox_meta.tier` + UI (no sandbox recreation).

**Credential injection (runtime):** value delegated at set-time to `sbx secret set`; at request time `sbx`'s host-side proxy injects the auth header into permitted outbound HTTP/HTTPS — the app is not in this runtime path (verifies PRD §Success Metric: 100% via proxy-injection, zero values in sandbox FS/image).

**Launch reconciliation:** app start → `#prereq-detector` gate → `#reconciler.reconcile()` (`sbx ls` ⟕ `sandbox_meta`) → dashboard renders app-created, external, and orphan cases.

## Failure & edge cases

- **`sbx` missing / not authed** → prereq gate blocks with remediation (R1); no silent failure.
- **`sbx rm` irreversibility** → confirmation modal; copy clarifies VM+images+packages deleted, host files preserved.
- **External sandbox with no app metadata** → render gracefully; tier "custom"; allow adopting/editing.
- **Orphaned metadata** (sandbox removed outside app) → detected by reconciler, GC'd.
- **PTY disconnect / sandbox stopped mid-session** → WS closes, `xterm.js` shows disconnected state, session cleaned up.
- **OS keychain unavailable** → R1 probe routes app-held material to AES-GCM fallback; primary secret path still delegates to `sbx` (which manages its own keychain).
- **`sbx` output format drift** → contained to `sbx/parse.ts`; JSON path preferred to minimize exposure.
- **Direct-mount implicit-execution exposure** → explicit warning in wizard step 2 (`direct-mode-warning`).
- **Attempt to allow non-HTTP protocol** → not offered in UI; policy editor is HTTP/HTTPS-domain-only.

## Conventions used

- **TypeScript strict mode** across main + renderer; shared types in a `types/` module imported by both.
- **Single-choke-point** rule for external process spawning: only `#sbx-adapter` touches `sbx`; only `#pty-bridge` owns `node-pty`.
- **Normalized error unions** (`SbxError`) over thrown strings; IPC returns `{ok,data}|{ok:false,error}`-shaped results.
- **No secret values in SQLite or sandbox FS** — enforced structurally in `#credential-manager`.
- **`sbx` is source of truth**; local DB is derived/supplementary and always reconciled, never trusted alone for state.
- **contextIsolation + preload allowlist**; renderer has no Node/`child_process` access.
- **Design tokens frozen first** (mockup `:root` → `theme/tokens.css`) before component build, per handoff.
- **Vite + electron-builder** for dev/build; `better-sqlite3` and `node-pty` are native deps requiring rebuild-for-Electron in the packaging step.

## Open questions / risks (for the planner)

1. **Which `sbx` subcommands emit machine-readable/`--json` output?** (carried from the brainstorm) — determines how much lives in the tolerant text-parser fallback. Planner should verify per-subcommand against the installed `sbx` version and size the `parse.ts` work accordingly.
2. **Agent-terminal attach mechanism.** Exact `sbx` command to *attach to the already-running Claude Code process* (vs. launching a new one) needs confirmation — is it `sbx exec` into the session, an `sbx attach`, or the dashboard's attach path? Impacts `#pty-bridge.openAgentPty`.
3. **Live traffic/monitoring feed availability.** Does `sbx` expose a streamable allowed/blocked egress log, or only on-demand `sbx policy check`? Determines whether `TrafficFeed` is live or polled (R7).
4. **Tier→allowlist concrete mapping.** The exact domain sets behind Open/Balanced/Locked Down, and how to detect/prune `sbx`'s **default wildcard** entries (e.g. `*.googleapis.com`) so the editor can show and remove them (R4).
5. **Claude Code in-sandbox auth flow end-to-end.** Confirm the `/login` OAuth token-on-host handshake maps cleanly onto `sbx secret set` service kits (`anthropic`) vs. requiring app-held handling (R5).
6. **Native-module packaging.** `better-sqlite3` + `node-pty` need per-platform rebuild against Electron's ABI; planner should scope electron-builder + `@electron/rebuild` config as a foundation task.
7. **Port-publish UX.** PRD doesn't call out `--publish`; `sbx` supports it. Confirm whether MVP exposes port mapping in the wizard or defers it (currently treated as optional/deferred).
8. **Design doc status.** Mockups are an on-disk export, not a SpecManager design-stage doc, so this architecture cannot be auto-flagged stale if they change. Planner may want the mockups promoted to a tracked design doc.
