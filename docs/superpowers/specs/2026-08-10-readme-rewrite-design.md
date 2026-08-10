# README Rewrite + Usage Guide — Design

**Date:** 2026-08-10
**Status:** Approved (design decisions confirmed with user)

## Problem

Today's `README.md` is developer-only (prerequisites, setup, scripts, project
structure) and badly out of date: it describes just two screens (Prereq,
Instances), while the app has since grown a full sidebar navigation, a 7-step
creation wizard, an instance-detail drill-in with five tabs, Settings (global
secrets, accounts, credential-storage guide), i18n, and theming. There is also
no usage guidance and no screenshots.

## Goal

Replace the README with a clear, concise document that serves **both**
audiences:

- **Run it** — a short developer quick-start (prerequisites, install, run).
- **Use it** — a screenshot-driven usage guide that walks a user through the
  real app flow: prereq gate → create a definition → launch an instance →
  manage it.

Track the work with a GitHub issue on `konica/ai-sandbox-manager`.

## Non-goals

- No changes to app code or behavior — documentation only.
- Not a full API/architecture reference; `docs/ARCHITECTURE.md` already covers
  internals and is linked, not duplicated.
- No new screenshot tooling; screenshots are captured manually by the user.

## Screenshots

The user captured 13 PNGs in the git-ignored `.screenshots/` directory. They
will be **copied into a tracked `docs/images/` folder** (next to
`docs/ARCHITECTURE.md`) so they render on GitHub. The original `.screenshots/`
stays git-ignored and untouched.

Manifest (source filename → guide use):

| Source (`.screenshots/`)               | README section                         |
|----------------------------------------|----------------------------------------|
| `sandbox-definitions.png`              | Hero + Definitions overview            |
| `prerequisites.png`                    | Prerequisites                          |
| `sandbox-defintions-workspace.png`     | Wizard step 1 — Workspace              |
| `sandbox-definition-base-image.png`    | Wizard step 2 — Base Image             |
| `sandbox-definition-network.png`       | Wizard step 3 — Network                |
| `sandbox-definitions-credentials.png`  | Wizard step 4 — Credentials            |
| `sandbox-definition-ports.png`         | Wizard step 5 — Ports                  |
| `sandbox-definition-advanced.png`      | Wizard step 6 — Advanced (kit YAML)    |
| `sandbox-definition-review.png`        | Wizard step 7 — Review                 |
| `sandbox-instance-terminal.png`        | Manage instance — Terminals tab        |
| `sandbox-instance-ports.png`           | Manage instance — Ports tab            |
| `sandbox-instance-files.png`           | Manage instance — Files tab            |
| `sandbox-instance-monitoring.png`      | Manage instance — Monitoring tab       |

Note the source-filename typos (`defintions`, mixed `definition/definitions`)
are preserved on copy or normalized in `docs/images/`; README references use the
tracked names, so any normalization is internal to the copy step.

## README structure

1. **Title + one-liner + hero screenshot** (`sandbox-definitions.png`).
2. **What it is / key concepts** — brief definitions of the core vocabulary the
   UI uses:
   - *Sandbox Definition* — a reusable spec describing an environment; one
     definition can launch many instances.
   - *Sandbox Instance* — a running/stopped isolated Docker Sandbox created from
     a definition.
   - *Agent* — the AI coding agent inside the sandbox (default: Claude Code).
   - *Network policy tier* — Open / Balanced / Locked Down egress presets, plus
     a domain allowlist.
   - *Credentials / Global secrets* — injected by a host-side proxy at runtime;
     secrets never enter the sandbox.
3. **Prerequisites** — trimmed table (Docker Engine, `sbx` CLI, `sbx login`,
   disk space, OS keychain) + `prerequisites.png` + verify commands.
4. **Install & run** — `npm install` → native-module ABI/rebuild note →
   `npm run dev`; note the prereq gate lands on Definitions once checks pass.
5. **Usage guide** (the new core):
   - **Check prerequisites** — the gate screen.
   - **Create a Sandbox Definition** — walk the 7-step wizard, one screenshot
     and a 1–2 sentence blurb per step (Workspace, Base Image, Network,
     Credentials, Ports, Advanced, Review).
   - **Launch an Instance** — the Launch dialog (session name, tags, Open
     with: Terminal / VS Code).
   - **Manage an Instance** — the detail tabs: Terminals (attach agent / open
     shell / copy `sbx` command), Ports (live port forwards + host services),
     Files (copy to/from sandbox), Monitoring (traffic log allow/deny +
     on-demand resource usage). Mention Apply live / Rebuild / Remove.
   - **Settings** — brief: default network tier, global secrets, Claude account
     sign-in.
6. **Scripts** — condensed table (dev, build, start, typecheck, test, rebuild).
7. **Project structure + tech stack** — condensed; link to `ARCHITECTURE.md`
   rather than duplicating internals.
8. **Troubleshooting** — keep existing entries (ABI mismatch, Electron ENOENT,
   prereq blocks on sbx/Docker).

## Terminology rule

All prose matches the real UI wording (Sandbox Definition, Sandbox Instance,
Network policy tier: Open/Balanced/Locked Down, Apply live, Rebuild, Attach,
Global secrets, Host services). Source of truth: `src/renderer/i18n/en.ts`.

## Execution

1. Copy the 13 screenshots from `.screenshots/` into tracked `docs/images/`.
2. Dispatch the `readme-generator` agent with: this design, the feature map, the
   screenshot manifest, and the structure above. The agent reads the repo
   directly so commands, scripts, and structure stay accurate (zero
   hallucination), and embeds the `docs/images/` references.
3. Verify: the README renders (image paths resolve, links valid), commands match
   `package.json`, terminology matches the UI.
4. Open a GitHub tracking issue via the repo `ticket-format` skill.

## Success criteria

- README opens with a hero screenshot and a one-paragraph "what it is".
- A new user can follow the usage guide end-to-end (prereq → define → launch →
  manage) with a screenshot at each major step.
- All `docs/images/` references resolve on GitHub.
- All shell commands and script names match `package.json`.
- Developer quick-start (install/run) is preserved and correct.
- A GitHub issue tracks the work.
