---
id: prd-local-sandbox-manager-for-coding-agents-001
featureId: feat-local-sandbox-manager-for-coding-agents
stage: prd
status: approved
stale: false
title: Local Sandbox Manager for Coding Agents PRD
dependsOn: []
basedOn: {}
generatedBy: agent
version: 3
createdAt: '2026-07-17T13:57:05.745Z'
updatedAt: '2026-07-18T00:14:19.207Z'
---
## Problem

Developers who want to run coding agents (Claude Code, etc.) with real filesystem and shell access reasonably want isolation — from a runaway agent action, a malicious dependency, or unreviewed egress to arbitrary hosts. Docker Sandboxes (`sbx`) provide this isolation (microVM per sandbox, deny-by-default network egress, credential-injecting proxy, read-write/read-only workspace mounts) but the raw interface is a CLI: install steps per OS, `sbx run --name <n> <agent>`, `sbx policy allow network <host>`, `sbx ports <n> --publish`, `sbx secret set`, `sbx ls`. Learning this CLI and mapping "I want the agent to reach only my registry and npm" into policy commands is friction most developers don't want to pay before they can just start working. There is no GUI that turns "which base image, which folders, what permissions, what hosts, what ports, what credentials" into a running, monitorable, interactive sandbox session.

## Users

- **Primary: individual developer running coding agents locally.** Wants sandbox isolation without learning `sbx` CLI syntax or Docker sandbox internals. Works in one or more project workspaces at a time, wants to babysit or steer the agent interactively, not just fire-and-forget.
- **Secondary (not targeted at MVP, informs assumptions): security-conscious developer/team lead** who cares that credentials and egress are actually constrained as configured, even if they never inspect the underlying policy.

Jobs-to-be-done:
1. "Let me describe a sandbox environment once (base image, folders, allowed hosts, ports, credentials) as a reusable **definition**, then spin up **instances** of it on demand."
2. "Let me point that environment at this repo (+ maybe a couple extra folders) and run it, without it touching the rest of my machine or the open internet."
3. "Let me see, at a glance, what's running, what it can reach, what ports are exposed, and what access it has."
4. "Let me actually talk to the agent's session — in the app or in my own terminal — not just launch it blind."
5. "Let me give the agent the credentials it needs (git, API keys) without pasting secrets into a Dockerfile or leaving them in a container image."

## Goals / Non-goals

**Goals (MVP):**
- Desktop-installed app (local web server + browser-rendered UI) for authoring sandbox **definitions**, launching and monitoring **instances** of them, and interacting with the running coding agent — no separate "server" component, no cloud account beyond what `sbx`/Docker itself requires.
- **Definitions → Instances model.** A **Sandbox Definition** is a reusable spec: agent = **Claude Code only** (fixed at MVP — see Non-goals), a **base image** (template), primary working directory, zero or more extra folders with per-mount permission (read-write "direct" vs read-only "clone"), a **network egress policy** (three tiers + allowlist), **published-port intents**, and the **credentials** needed. An **Instance** is a running Docker Sandbox launched from a definition (given an instance name); one instance = one `sbx` sandbox. The app has a **Definitions** screen (list of specs) and an **Instances** screen (running/stopped sandboxes, with the definition each came from).
- **Base image selection.** The definition wizard lets the user choose the sandbox base image/template, applied via `sbx`'s `--template`. Because the agent is fixed to Claude Code, the base must be a `claude-code*` variant (default `docker/sandbox-templates:claude-code-docker`) or a custom template derived from one (a `docker.io/org/img:tag` field). The user never hand-writes a Dockerfile through the app at MVP.
- The app is the sole author of the underlying `sbx` configuration (whatever `sbx` invocations, policy rules, secret registrations, and port forwards are needed) — the user never hand-edits `sbx` CLI commands, policy syntax, or kit definitions.
- **Instance lifecycle management:** launch (from a definition), start, stop, remove; list view showing status, source definition, workspace path, agent, network tier, and published ports.
- **Three terminal surfaces per running instance,** rendered/launched natively by the app: (a) an **in-app agent terminal** attached to the running Claude Code session; (b) an **in-app shell terminal** (plain `bash`) for manual inspection independent of the agent; and (c) an optional **native host terminal** ("Open in host terminal") that launches the OS's own terminal app bound to the instance — targeting either the agent session or a shell — running independently and surviving app close. On **launch** of an instance, the app auto-opens a **native host terminal connected to the Claude Code agent** so the developer continues work there. (This amends the earlier "no external terminal windows" position: two in-app terminals by default, plus the host-terminal escape hatch.) The host terminal is **macOS at MVP**, with Linux/Windows planned; the two in-app terminals cover all platforms.
- **Published ports.** Each instance can publish ports between sandbox and host. The definition wizard collects port **intents**; the app forwards them once the instance is running (ports cannot be set at create time — see Constraints), and the instance Detail view has a live Ports panel to add/remove forwards anytime. Forwards bind to `127.0.0.1`.
- **Network policy UI is framed as three tiers — Open / Balanced / Locked Down**, applied per definition/instance; new definitions default to **Locked Down**. Each tier maps to Docker's actual allowlist semantics (`sbx policy allow network <host>`), and the user can fine-tune the domain allowlist underneath the selected tier. HTTP/HTTPS only; raw TCP/UDP/ICMP cannot be selectively allowed — they are always blocked, and the UI must not imply otherwise.
- **Credential input UI maps to `sbx secret set` semantics:** credentials are registered so Docker's host-side proxy can inject them into permitted outbound requests; the app never bakes credentials into an image or writes them into the sandboxed filesystem. At rest, the app supports **both** an OS-native credential store (macOS Keychain / Windows Credential Manager / Linux Secret Service), used when available, **and** an app-managed encrypted store as the fallback — not an either/or.
- **Live monitoring.** The instance Detail view has a Monitoring panel showing egress activity — allowed/blocked requests, a pending-requests indicator, and a blocked-count badge — surfaced only to the extent `sbx` exposes it (depth deferred; no invented telemetry).

**Non-goals (MVP):**
- Support for coding agents other than Claude Code. The MVP creation flow, credential fields, and auth-flow handling are built specifically around Claude Code's actual auth flow (in-sandbox `/login` OAuth token kept on host) rather than generalized for hypothetical future agents. No speculative multi-agent abstraction.
- Multi-user / team features: shared definition catalogs, centralized org-level policy. This app is confirmed **single-user, single-machine** for MVP — locked in.
- Remote/hosted operation — this is a local, single-machine desktop app only.
- Building any isolation mechanism ourselves. All isolation, network enforcement, port forwarding, and credential injection is delegated to Docker Sandboxes; this app is strictly a configuration/control-plane UI over `sbx`.
- Custom/non-Docker sandbox backends.
- Authoring third-party kits/Dockerfiles through the app beyond selecting a base image/template ref.
- **Per-instance workspace isolation.** For MVP, instances launched from the same definition **share the workspace path**; git-worktree-per-instance isolation is the planned post-MVP model, not built now.
- Auto-restart of sandboxes that were running when the app was last closed. On next launch, previously-running instances are shown in whatever state `sbx` reports; restarting is a manual, user-driven action.

## Success Metrics

- A developer with Docker Sandboxes already installed can go from "open the app" to "an instance running against my repo with a working policy" without ever typing an `sbx` command, in under N minutes (target: <5 min first-run).
- Zero cases in usability testing where a user needs to open a terminal to inspect or fix the generated `sbx` config to get an instance working.
- 100% of credentials configured through the app arrive via Docker's proxy-injection path (verified: no credential value ever written to the sandbox filesystem or baked into an image the app builds).
- Time-to-first-interaction with a terminal (in-app agent/shell or the auto-opened host terminal) from launch (target: single click/action, auto on launch for the agent).

## Constraints & Assumptions

Grounded in Docker Sandboxes' documented model (get-started, security, architecture, usage, customize/templates docs):

| Area | Constraint (from Docker) | Implication for this app |
|---|---|---|
| Isolation boundary | microVM per sandbox, separate kernel, isolated Docker daemon; no shared memory/process with host | App cannot offer isolation stronger or weaker than this — no "isolation level" knob beyond what `sbx` exposes |
| Base image / templates | Base images are `docker/sandbox-templates:<variant>`; the running agent is chosen by the `sbx run` positional arg and must match the base variant; custom templates extend a base via Dockerfile or a saved sandbox; `--template` selects the image and `sbx` won't auto-resolve `docker.io` | ImagePicker offers `claude-code*` built-ins (default `claude-code-docker`) + a custom `docker.io/org/img:tag` field; base applied via `--template` at launch |
| Network egress | Deny-by-default; only HTTP/HTTPS to allowlisted domains proxied through host; raw TCP/UDP/ICMP always blocked; default allowlists include broad wildcards (e.g. `*.googleapis.com`) that may need pruning | Network policy UI = three-tier (Open/Balanced/Locked Down, default Locked Down) domain allowlist editor; must allow pruning default wildcards |
| Published ports | Ports **cannot** be published at create time — there is no `--publish` on `sbx run`/`sbx create`; forward after the sandbox is running via `sbx ports <name> --publish 8080:3000` (and `--unpublish`); forwards bind to `127.0.0.1`; sandboxes are otherwise network-isolated | Wizard collects port *intents*; app forwards them right after launch; Detail view has a live Ports panel; never render create-time ports as active |
| Filesystem mounts | Two modes only: "direct" (read-write, live passthrough, same absolute path) or "clone" (read-only view); direct mode can silently expose implicit-execution files (git hooks, CI config, Makefiles) | Per-folder permission = choice between these two modes; UI warns about implicit-execution-file exposure in direct mode |
| Credentials | Injected via host-side proxy that adds auth headers to outbound requests; raw values never enter the VM; registered via `sbx secret set` (stdin-capable, OS-keychain-backed) | App routes all credential values through `sbx secret set`; no in-app "write a .env into the workspace" fallback |
| Lifecycle | `sbx stop` preserves VM/state; `sbx rm` deletes everything (VM, images, packages) irreversibly; host workspace files are never deleted | Stop vs. remove are distinct, clearly-differentiated actions given the irreversibility asymmetry |
| Prerequisite | Docker Sandboxes (`sbx`) must already be installed and authenticated (`sbx login`) on the host | App does not install/replace `sbx`; first-run detects/verifies (Docker, `sbx`, `sbx login`, plus available disk and OS-keychain reachability), never silently fails |

**Locked-in decisions (resolved from prior Open Questions):**
- **Single-user, single-machine scope**: confirmed, no multi-user auth or shared state.
- **Credential storage at rest**: both OS-native credential store (preferred) and an app-managed encrypted store (fallback) — not either/or. Secret *values* are delegated to `sbx secret set`; the app persists only associations/metadata.
- **Restart-resume**: no auto-restart on app launch; fully manual.
- **Second-agent generalization**: deferred; MVP is Claude Code only.
- **Default network policy tier**: three-tier Open/Balanced/Locked Down, defaulting to Locked Down.
- **Terminals**: two in-app (agent + shell) + an optional native host terminal (macOS at MVP, Linux/Windows planned); launch auto-opens a host agent terminal.
- **Definitions vs Instances — live edits sync to the definition.** The common case is 1:1 definition-to-instance, so tier/domain/port changes made on a running instance persist back to the parent definition (not instance-scoped overrides).
- **Shared workspace for MVP.** Instances of a definition share the workspace path; git-worktree-per-instance isolation is a post-MVP plan.
- **Credentials shared across a definition's instances** (not per-instance isolated).
- **Monitoring depth deferred (TBD).**

## High-Level User Flows

- **Create a definition:** name/description → choose base image (default `claude-code-docker`, or custom template ref) → working directory + optional extra folders with per-folder mode (direct/clone) → network tier (defaults **Locked Down**; may switch or fine-tune allowlist) → declare published-port intents → attach credentials (git, Claude Code auth, other API keys) → review & save. Persists a reusable spec to the app's local store; no sandbox is created and no secret is set yet.
- **Launch an instance:** from a definition, provide an instance name → the app translates the definition into `sbx run` (with `--template` base image + mounts), applies the network tier, registers each credential via `sbx secret set`, and — since ports can't be set at create — forwards the definition's port intents once running. On success it opens the instance Detail view and auto-launches a **native host terminal connected to the Claude Code agent**.
- **Start / stop / monitor:** Instances list shows instance name, status, source definition, workspace path, Claude Code as the fixed agent, network tier, and published ports; start/stop/remove per row with removal requiring confirmation given `sbx rm` irreversibility. Instances left running when the app was last closed appear as-is on next launch and are not auto-restarted.
- **Interactive session (agent, in-app):** from a running instance, an in-app PTY terminal attached to the Claude Code session.
- **Interactive session (shell, in-app):** a second, independent in-app terminal (plain `bash`) for manual inspection.
- **Interactive session (host terminal):** "Open in host terminal" launches a native OS terminal bound to the instance (agent or shell target), independent of the app.
- **Adjust policy on a live instance:** view/edit the network tier and allowlist without recreating; changes persist back to the parent definition.
- **Manage published ports:** on a running instance, forward/remove host:container ports (bound to `127.0.0.1`); changes persist back to the parent definition.
- **Monitor egress:** the Monitoring panel surfaces allowed/blocked requests and a blocked-count badge to the extent `sbx` exposes it.
- **Detect pre-existing sandboxes:** on launch, the app queries `sbx` for sandboxes it didn't create in-session and represents them in the Instances list (with no linked definition), so the app is a true control surface over `sbx` state.

## Open Questions

All prior open questions have been resolved and folded into the sections above. Remaining items that are implementation-level (for architecture/plan, not PRD scope): the exact `sbx` command to attach to the already-running Claude Code process, how much live egress detail `sbx` exposes for the Monitoring feed (depth is intentionally deferred), and the concrete tier→allowlist domain sets. No product-scope questions remain open as of this revision.
