# AI Sandbox Manager — Component & Flow Design

_Date: 2026-07-18 · Status: design (for review)_
_Grounded in: PRD `prd-local-sandbox-manager-for-coding-agents-001` (v3) and the mockup export `brainstorm/mockup/AI Sandbox Manager v3` (Definitions → Instances model; v3 content is identical to the earlier v2)._
_Note: the SpecManager architecture doc `arch-local-sandbox-manager-for-coding-agents-001` (v1) predates this model and has not been reconciled to it — this design doc is the current source for the Definitions→Instances component/flow design._
_Rendered companion (diagrams): Artifact `f680b816-a1f9-4e25-bddd-d2be611a1982`._

## 1. Purpose & scope

A local, single-user **Electron desktop app** that is a control-plane GUI over the Docker Sandboxes CLI (`sbx`). It lets a developer run the Claude Code coding agent inside an isolated Docker Sandbox against a chosen workspace — without ever typing an `sbx` command. The app builds **no** isolation itself; all isolation, egress enforcement, and credential injection are delegated to `sbx`. The app composes `sbx` invocations, streams terminals into the UI, launches native host terminals, and keeps a thin local metadata store reconciled against `sbx` (the source of truth for sandbox existence and state).

This document consolidates the **main components** and their **flowcharts**. It does not restate the full PRD/architecture; it makes the structure and behavior visual and records the decisions taken during the design brainstorm.

### Confirmed tech stack

| Layer | Choice |
|---|---|
| App shell | Electron (Node main + bundled Chromium renderer) |
| Renderer UI | React + Vite + TypeScript |
| Terminals | xterm.js (renderer) ⇄ node-pty (main), over a localhost WebSocket |
| Host terminal | pluggable per-OS launcher (macOS at MVP; Linux/Windows planned) |
| sbx integration | CLI shell-out only (`child_process`); no SDK exists |
| App metadata | better-sqlite3 |
| Credential values | delegated to `sbx secret set` (stdin); app never persists values |
| App-held secret material | keytar (OS keychain) + AES-GCM encrypted-file fallback |

## 2. Core model: Definitions → Instances

- **Sandbox Definition** — a reusable spec authored in the app and stored in SQLite: name/description, base image (template), working directory + extra folders (with per-folder mount mode), network tier + allowlist, published-port intents, and credentials. Nothing runs until a definition is launched.
- **Instance** — a running Docker Sandbox launched from a definition (given an instance name). One instance = one `sbx` sandbox running Claude Code.
- The common case is **1:1** definition-to-instance, so **live edits on a running instance sync back to the parent definition** (see §6).

## 3. Overview

```mermaid
flowchart LR
  U(["Developer"]):::user
  subgraph APP["AI Sandbox Manager · Electron"]
    direction TB
    UI["Renderer UI · React · xterm.js"]:::renderer
    CORE["App Core · Electron main"]:::module
  end
  DEF[("Definitions · reusable specs · SQLite")]:::store
  SBX["sbx CLI · Docker Sandboxes"]:::sbx
  KC[("OS Keychain · AES fallback")]:::store
  VM["Instance · microVM · Claude Code + egress proxy"]:::sandbox
  NET(["Internet · allowlisted domains"]):::ext

  U -->|clicks / types| UI
  UI <-->|IPC / WebSocket| CORE
  CORE -->|author / read / sync live edits| DEF
  DEF ==>|launch instance| CORE
  CORE -->|shell-out| SBX
  CORE -->|app secrets| KC
  SBX ==>|creates --template & controls| VM
  VM -.->|allowed HTTP/S only| NET
  U -.->|published port · 127.0.0.1:8080| VM

  classDef user fill:#0b0f16,stroke:#4f8cff,color:#e6edf3;
  classDef renderer fill:#12233f,stroke:#4f8cff,color:#cfe0ff;
  classDef module fill:#1c2333,stroke:#55627a,color:#e6edf3;
  classDef sbx fill:#2e2410,stroke:#e3a008,color:#f6d488;
  classDef store fill:#12261a,stroke:#3fb950,color:#a7e6b8;
  classDef sandbox fill:#2a1420,stroke:#f778ba,color:#f9c6df;
  classDef ext fill:#0b0f16,stroke:#7d8896,color:#9aa5b3;
```

## 4. Components

Six renderer screens, one preload/IPC bridge, eight single-purpose main-process modules. Two hard choke points: only `#sbx-adapter` spawns `sbx`; only `#pty-bridge` owns `node-pty`.

```mermaid
flowchart TB
  subgraph RENDERER["Renderer · React (Chromium)"]
    direction TB
    SCREENS["Screens · Prereq · Definitions · Instances · Create Definition · Detail · Settings"]:::renderer
    COMPS["Components · DefinitionWizard · ImagePicker · MountList · PolicyEditor · PortManager · CredentialForm · Terminal · Monitoring"]:::renderer
    CLIENT["ipc/client.ts"]:::renderer
    SCREENS --> COMPS --> CLIENT
  end
  PRELOAD["preload.ts · contextBridge allowlist"]:::bridge
  subgraph MAIN["Main · Electron (Node)"]
    direction TB
    HANDLERS["ipc/handlers.ts"]:::bridge
    PREREQ["#prereq-detector"]:::module
    ADAPTER["#sbx-adapter (+ parse.ts)"]:::module
    RECON["#reconciler"]:::module
    POLICY["#policy-controller"]:::module
    PORTS["#ports-controller"]:::module
    CREDS["#credential-manager"]:::module
    PTY["#pty-bridge · node-pty · WS · host launch"]:::module
    MON["#monitor · egress feed"]:::module
    STORE["#metadata-store · definitions + instance meta"]:::module
  end
  SBX["sbx CLI"]:::sbx
  KC[("keytar / AES")]:::store
  DB[("better-sqlite3")]:::store
  OS(["Host terminal · OS"]):::ext

  CLIENT -->|invoke| PRELOAD --> HANDLERS
  HANDLERS --> PREREQ & ADAPTER & RECON & POLICY & PORTS & CREDS & PTY & MON & STORE
  PREREQ -.probe.-> SBX
  PREREQ -.probe.-> KC
  ADAPTER --> SBX
  RECON --> ADAPTER
  RECON --> STORE
  POLICY --> ADAPTER
  PORTS -->|sbx ports| ADAPTER
  PORTS --> STORE
  CREDS -->|secret set stdin| ADAPTER
  CREDS -->|app secrets| KC
  CREDS -->|links only| STORE
  MON -->|egress logs| ADAPTER
  STORE --> DB
  PTY ==>|in-app: sbx exec -it| SBX
  PTY -.->|spawn host term| OS
  OS -.->|runs sbx itself| SBX

  classDef renderer fill:#12233f,stroke:#4f8cff,color:#cfe0ff;
  classDef bridge fill:#10302d,stroke:#3fb0ac,color:#bdf0eb;
  classDef module fill:#1c2333,stroke:#55627a,color:#e6edf3;
  classDef sbx fill:#2e2410,stroke:#e3a008,color:#f6d488;
  classDef store fill:#12261a,stroke:#3fb950,color:#a7e6b8;
  classDef ext fill:#0b0f16,stroke:#7d8896,color:#9aa5b3;
```

| Module | Responsibility |
|---|---|
| `#prereq-detector` | First-run checks: Docker, `sbx` on PATH, `sbx login`, disk headroom, OS-keychain reachability. |
| `#sbx-adapter` | The only `sbx` spawn site. JSON-first, text-fallback parsing; normalized `SbxError` union. |
| `#reconciler` | Joins `sbx ls` (instances) with local `instance_meta` + `definition`; `sbx` wins on status. |
| `#policy-controller` | Tier ↔ allowlist translation; `sbx policy allow/reset/inspect`. |
| `#ports-controller` | `sbx ports --publish/--unpublish/inspect` (post-run only; binds `127.0.0.1`). |
| `#credential-manager` | Values → `sbx secret set` (stdin); app metadata + keychain/AES fallback. No value in SQLite. |
| `#pty-bridge` | node-pty ⇄ localhost WebSocket for in-app terminals; pluggable per-OS host-terminal launcher. |
| `#monitor` | Reads `sbx` egress/policy output for the Monitoring feed (depth TBD). |
| `#metadata-store` | better-sqlite3: definitions + instance metadata; reconciliation joins. |

## 5. Terminal model

Three terminal surfaces per running instance:

1. **In-app agent terminal** — attaches to the running Claude Code process (xterm.js ⇄ node-pty over localhost WS).
2. **In-app shell terminal** — a fresh `bash` via `sbx exec -it <name> bash`, independent of the agent.
3. **Native host terminal** (escape hatch) — launches the OS's own terminal app bound to the instance (agent or shell target), runs independently, survives closing the app. macOS at MVP; Linux/Windows planned.

On **launch of an instance**, the app auto-opens a **native host terminal connected to the Claude Code agent** so the developer continues work there immediately.

## 6. Flows

### 6.1 Create definition (persist a spec — nothing runs)

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer
  participant W as Create Definition wizard
  participant IPC as IPC handlers
  participant A as #sbx-adapter
  participant S as #metadata-store
  Dev->>W: name/desc · base image · folders · tier · ports · creds
  opt validate base image
    W->>IPC: def:validateImage(ref)
    IPC->>A: resolveTemplate(ref)
    A-->>W: ok — claude-code* variant / custom template
  end
  W->>IPC: def:create(spec)
  IPC->>S: insert definition (mounts · policy · ports · cred refs)
  Note over IPC,S: no sbx call · no sandbox · secret values not stored, only which creds to inject
  IPC-->>W: Definition saved → Definitions list
```

**Base image:** applied at launch via `--template`. Must be a `claude-code*` variant (default `docker/sandbox-templates:claude-code-docker`) or a custom template derived from one (ImagePicker offers built-ins + a custom `docker.io/org/img:tag` field).

### 6.2 Launch instance (the sbx-heavy flow → straight into the agent)

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer
  participant DL as Launch modal
  participant IPC as IPC handlers
  participant S as #metadata-store
  participant A as #sbx-adapter
  participant P as #policy-controller
  participant C as #credential-manager
  participant PO as #ports-controller
  participant SBX as sbx CLI
  participant PTY as #pty-bridge
  participant OS as Host terminal (OS)
  Dev->>DL: "Launch Instance" + instance name
  DL->>IPC: instance:launch(defId, name)
  IPC->>S: read definition spec
  IPC->>A: createSandbox(spec)
  A->>SBX: sbx run claude (--template <base image>, + mounts)
  SBX-->>A: instance running (agent started)
  IPC->>P: applyTier(name, spec.tier)
  P->>SBX: sbx policy reset + allow network …
  loop each credential in spec
    IPC->>C: setSecret(value)
    C->>SBX: sbx secret set (stdin)
  end
  loop each port (only now, running)
    IPC->>PO: publish(name, host:container)
    PO->>SBX: sbx ports <name> --publish 8080:3000
  end
  Note over C,SBX: secrets shared across this definition's instances · MVP shares the workspace path too
  IPC->>S: write instance_meta → definition
  DL->>IPC: pty:openHostTerminal(name, agent) — auto
  IPC->>PTY: launchHostTerminal(name, agent)
  PTY->>OS: spawn OS terminal → sbx exec -it <name> (Claude Code)
  OS-->>Dev: native terminal bound to the agent — continue here
  Note over PO,OS: ports can't be set at create · bind 127.0.0.1 · host terminal macOS at MVP
```

### 6.3 Attach terminals (two in-app + host escape hatch)

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer
  participant D as Detail · Terminals
  participant IPC as IPC handlers
  participant PTY as #pty-bridge
  participant NP as node-pty
  participant SBX as sbx CLI
  participant X as xterm.js
  participant OS as Host terminal (OS)
  par Agent terminal · in-app
    D->>IPC: pty:openAgent(name)
    IPC->>PTY: openAgentPty(name)
    PTY->>NP: spawn → attach agent
    NP->>SBX: sbx exec (Claude Code session)
    PTY-->>D: { wsUrl, token }
    D->>X: connect xterm ⇄ WS
  and Shell terminal · in-app
    D->>IPC: pty:openShell(name)
    IPC->>PTY: openShellPty(name)
    PTY->>NP: spawn
    NP->>SBX: sbx exec -it <name> bash
    PTY-->>D: { wsUrl, token }
    D->>X: connect xterm ⇄ WS
  end
  X-->>NP: keystrokes · resize (over WS)
  NP-->>X: PTY bytes (over WS)
  opt Open in host terminal (agent or shell)
    Dev->>D: "Open in host terminal"
    D->>IPC: pty:openHostTerminal(name, target)
    IPC->>PTY: launchHostTerminal(name, target)
    PTY->>OS: spawn OS terminal → sbx exec -it <name> (agent | bash)
    OS-->>Dev: native window, independent of the app
  end
  Note over PTY,OS: 127.0.0.1 · per-session token · host terminal macOS at MVP, Linux/Windows planned
```

### 6.4 Live policy edit (syncs to the definition)

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer
  participant PE as PolicyEditor
  participant IPC as IPC handlers
  participant P as #policy-controller
  participant SBX as sbx CLI
  participant S as #metadata-store
  Dev->>PE: switch tier · add/remove domain
  alt switch tier
    PE->>IPC: policy:applyTier(name, tier)
    IPC->>P: applyTier
    P->>SBX: sbx policy reset + allow network …
  else edit one domain
    PE->>IPC: policy:addDomain / removeDomain
    IPC->>P: add / remove
    P->>SBX: sbx policy allow network <host>
  end
  P->>SBX: sbx policy inspect
  SBX-->>P: current { tier, domains }
  P->>S: sync tier/domains → definition (1:1) + instance
  IPC-->>PE: refreshed policy — no recreate
  Note over PE,SBX: HTTP/HTTPS domains only · raw TCP/UDP/ICMP always blocked · live edits persist to the definition
```

### 6.5 Manage published ports (post-run; syncs to the definition)

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer
  participant PM as PortManager
  participant IPC as IPC handlers
  participant PO as #ports-controller
  participant SBX as sbx CLI
  participant S as #metadata-store
  Dev->>PM: forward host:container · or remove
  alt publish
    PM->>IPC: ports:publish(name, 8080:3000)
    IPC->>PO: publish
    PO->>SBX: sbx ports <name> --publish 8080:3000
  else unpublish
    PM->>IPC: ports:unpublish(name, 8080:3000)
    IPC->>PO: unpublish
    PO->>SBX: sbx ports <name> --unpublish 8080:3000
  end
  PO->>SBX: sbx ports <name> (inspect)
  SBX-->>PO: 127.0.0.1:8080->3000/tcp
  PO->>S: sync ports → definition (1:1) + instance
  IPC-->>PM: live forwarded ports
  Note over PM,SBX: forwards bind to 127.0.0.1 only · instance stays isolated otherwise
```

### 6.6 Monitoring feed

```mermaid
sequenceDiagram
  autonumber
  participant MUI as Monitoring panel
  participant IPC as IPC handlers
  participant MON as #monitor
  participant SBX as sbx CLI
  MUI->>IPC: monitor:subscribe(name)
  IPC->>MON: start(name)
  loop while panel open
    MON->>SBX: sbx policy / egress logs
    SBX-->>MON: allowed · blocked · pending
    MON-->>MUI: feed rows + blocked-count badge
  end
  MUI->>IPC: monitor:unsubscribe(name)
  IPC->>MON: stop(name)
  Note over MON,SBX: read-only · degrades gracefully if sbx exposes no live stream
```

### 6.7 Launch reconciliation

```mermaid
sequenceDiagram
  autonumber
  participant M as Electron main
  participant PR as #prereq-detector
  participant R as #reconciler
  participant A as #sbx-adapter
  participant S as #metadata-store
  participant SBX as sbx CLI
  participant DB as Instances view
  M->>PR: check()
  PR->>SBX: docker? · sbx? · sbx login? · disk? · keychain?
  alt prerequisites fail
    PR-->>DB: show Prereq screen + remediation
  else prerequisites pass
    M->>R: reconcile()
    R->>A: listSandboxes()
    A->>SBX: sbx ls
    SBX-->>A: instances
    R->>S: join instance_meta + definitions
    Note over R: external instance → no definition ("—") · orphan meta → GC
    R-->>DB: InstanceView[] (sbx wins on status)
  end
```

## 7. Resolved decisions (MVP)

1. **Live edits sync to the definition.** The common case is 1:1 definition-to-instance, so tier/domain/port changes on a running instance persist back to the parent definition (not instance-scoped overrides).
2. **Shared workspace for MVP.** Instances of a definition share the workspace path. Per-instance isolation via **git worktrees** is the planned post-MVP model — not built at MVP.
3. **Credentials shared across a definition's instances** (not injected per-instance in isolation).
4. **Monitoring depth — deferred (TBD).** The allowed/blocked/pending feed exists in the UI; exactly how much `sbx` exposes and the polling-vs-streaming model are decided later.

## 8. Grounded `sbx` constraints (must hold in the UI)

- microVM isolation, separate kernel/daemon — the app offers no isolation knob beyond what `sbx` exposes.
- Egress deny-by-default; **HTTP/HTTPS to allowlisted domains only**; raw TCP/UDP/ICMP always blocked.
- Mounts: **direct** (read-write passthrough) or **clone** (read-only) — the only two modes; warn on direct-mode implicit-execution files.
- Credentials injected via `sbx`'s host-side proxy; raw values never enter the VM; registered via `sbx secret set` (stdin, OS-keychain-backed).
- **Ports cannot be published at create time** — no `--publish` on `sbx run`/`sbx create`; forward post-run via `sbx ports --publish` (binds `127.0.0.1`).
- Base image via `--template docker.io/...` (`sbx` won't auto-resolve `docker.io`).
- `sbx stop` preserves state; `sbx rm` is irreversible (deletes VM+images+packages; host files untouched) — distinct, differently-weighted UI actions.
- No auto-restart on app launch; restart is a manual action.

## 9. Deferred / open (for the plan)

- Which `sbx` subcommands emit machine-readable/`--json` output (sizes the text-parser fallback).
- Exact command to attach to the **running** Claude Code process (vs. launching a new one).
- Monitoring feed depth + polling-vs-streaming model (decision deferred).
- Concrete tier→allowlist domain sets and detecting/pruning `sbx` default wildcards.
- Claude Code in-sandbox `/login` OAuth handshake end-to-end vs. `sbx secret set`.
- Native-module packaging: `better-sqlite3` + `node-pty` rebuilt against Electron's ABI.
- Post-MVP: git-worktree-per-instance workspace isolation.
