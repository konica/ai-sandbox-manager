# Sandbox Instance Detail Screen (v8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sandbox Instance **Detail** screen (drill-in from the Instances list) matching `brainstorm/mockup/AI Sandbox Manager v8`: a header + three tabs — **Terminals** (native launch buttons + read-only info sidebar), **Ports** (live add/remove forwards + host services), **Monitoring** (allowed/blocked counters + traffic log from `sbx policy log`).

**Architecture:** The detail screen is an in-app sub-view of the Instances screen selected by `detailName` state (a drill-in, not a nav item). It's composed of small focused components: `InstanceDetail` (shell + header + tabs) and one component per tab (`TerminalsTab`, `PortsTab`, `MonitoringTab`). Terminals reuse the existing **native Terminal.app** launch IPC (attach/shell) — **no in-app terminals** (per the scope decision); the sidebar reads the definition spec via the existing `def:getSpec`. Ports and Monitoring add new `SbxAdapter` methods + IPC (`sbx ports --publish/--unpublish`, `sbx policy log`). Delivery is foundation-first: each phase leaves a working screen.

**Tech Stack:** Electron (main/preload/renderer), React 18 + TypeScript strict, better-sqlite3, Vitest + @testing-library/react (jsdom), custom i18n. No new native modules.

## Global Constraints

- **Run the full suite with `npm test`, never bare `npx vitest`** — `pretest` flips better-sqlite3 to the Node ABI; bare vitest fails DB tests.
- **No in-app terminals.** Terminal actions open the native Terminal.app via the existing `instance:attach` / `instance:shell` IPC (osascript). Do **not** add `node-pty`/`xterm`. This is the deliberate architecture (`sbx create/run` needs a real TTY and hangs from the main process).
- **Only `SbxAdapter` spawns `sbx`; only `terminal.ts` owns osascript.** New port/policy calls go through `SbxAdapter`.
- **`sbx reset` / `sbx policy reset` are FORBIDDEN** — global, destroy all sandboxes/secrets.
- **`sbx` port spec:** `[[HOST_IP:]HOST_PORT:]SANDBOX_PORT[/PROTOCOL]` (verified in the ports work). Publish `--publish <spec>`, remove `--unpublish <spec>`. Port forwarding is a **post-run** operation (works on a running sandbox).
- **No secret values anywhere in the renderer or SQLite.** The Credentials sidebar shows metadata only (service/env-var + a masked placeholder), read from the definition spec's `credentials` — never a real value.
- **Reuse existing CSS.** `detail-header`, `detail-tabs`, `terminal-panel`, `port-row`, `port-status`, `mon-summary`, `mon-stat`, `card-header`, `card-title`, `mount-row`, `badge`, `tag`, `code-inline` already exist in `src/renderer/theme/app.css`. Only `port-proto` and `cred-type-group` are missing (add them in the phase that first needs them).
- **`InstanceView` shape (existing):** `{ name; status: 'running'|'stopped'|'error'|'unknown'; agent; workspace: string|null; ports: string[]; definitionId: string|null; definitionName: string|null; tier: Tier|'custom' }`. An instance may have `definitionId: null` (adopted/unknown) — the sidebar must degrade gracefully.

---

## Phase 0 — Spike (run once, before Phases 3–4)

**Manual + empirical.** Validates the two `sbx` mechanisms the Ports and Monitoring tabs depend on. Phases 1–2 don't need it. Output: append answers to this plan's Spike Findings section.

### Task 0: Validate live ports + policy log

**Files:** none (findings recorded in this plan file)

- [ ] **Step 1: Confirm live publish/unpublish on a RUNNING sandbox.** With a running sandbox `<s>` (create a throwaway one or reuse an existing running instance):

```bash
sbx ports <s> --publish 18080:18080/tcp     # add a forward while running
sbx ports <s>                                # list — expect 18080 present
sbx ports <s> --unpublish 18080:18080/tcp    # remove it
sbx ports <s>                                # list — expect 18080 gone
sbx ports <s> --json                         # inspect the JSON list shape
```

Record: does `--publish`/`--unpublish` work post-run without recreating? What is the **exact `--unpublish` spec** it accepts (does it need the full `host:container/proto`, or just the host port)? What does `sbx ports <s> --json` return (field names)?

- [ ] **Step 2: Confirm `sbx policy log` output + JSON.** Run:

```bash
sbx policy log --help                        # flags: does it support --json? --follow? a limit?
sbx policy log <s>                            # or global; capture a few lines
sbx policy log --json 2>/dev/null | head      # if --json exists, capture the row shape
```

Record: is the log **per-sandbox or global**? Does `--json` exist and what are the row fields (timestamp, sandbox, host/domain, action allowed/blocked, rule/reason)? Is there a `--follow`/stream mode, or must the app **poll** `policy log` on an interval? (The earlier ports spike already showed a text table with columns SANDBOX / TYPE / HOST / PROXY / RULE / REASON / LAST SEEN / COUNT, plus an "Allowed requests:" section — confirm and get exact JSON if available.)

- [ ] **Step 3: Record findings** in the **Spike Findings** section below, and adjust Phase 3 (unpublish spec) / Phase 4 (polling vs stream, JSON vs text parse) to match. Commit:

```bash
git add docs/superpowers/plans/2026-07-19-sandbox-instance-detail.md
git commit -m "docs(spike): validate sbx live ports + policy log for the detail screen"
```

### Spike Findings

_(fill in after running Task 0)_
- Live publish/unpublish post-run: …
- Exact `--unpublish` spec accepted: …
- `sbx ports --json` shape: …
- `sbx policy log`: per-sandbox vs global; `--json` fields; poll vs follow: …

**Assumptions Phases 3–4 proceed on (correct if the spike disproves them):** `sbx ports <name> --publish <spec>` / `--unpublish <spec>` work on a running sandbox with the full `[host:]container/proto` spec; `sbx policy log` is pollable and parseable (JSON preferred, text table fallback) with allowed/blocked rows carrying host + reason.

---

## Phase 1 — Foundation: detail shell + drill-in

### Task 1: Instances list → open a detail view

**Files:**
- Modify: `src/renderer/screens/Instances.tsx` (add an `onOpen?(name)` prop + make the instance name a clickable button)
- Test: `tests/renderer/Instances.test.tsx` (extend)

**Interfaces:**
- Produces: `Instances` gains `onOpen?: (name: string) => void`; the instance-name cell becomes a `button` (or link) calling `onOpen(name)`.

- [ ] **Step 1: Read `src/renderer/screens/Instances.tsx`** to see the current row markup and prop signature (`{ instances, onAttach?, onShell?, onStop?, onRemove? }`) and the `Truncate` helper.

- [ ] **Step 2: Write the failing test** (extend `tests/renderer/Instances.test.tsx`)

```tsx
it('opens the detail view when the instance name is clicked', () => {
  const onOpen = vi.fn()
  render(<Instances instances={[{ name: 'my-box', status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'My Box', tier: 'locked' }]} onOpen={onOpen} />)
  fireEvent.click(screen.getByRole('button', { name: 'my-box' }))
  expect(onOpen).toHaveBeenCalledWith('my-box')
})
```

- [ ] **Step 3: Run test to verify it fails** — `npm test -- Instances` → FAIL.

- [ ] **Step 4: Implement.** Add `onOpen?: (name: string) => void` to the props type. Change the instance-name cell so the name is a `<button className="link-button" onClick={() => onOpen?.(i.name)}>{i.name}</button>` (keep the existing `Truncate`/tooltip around it). Add a minimal `.link-button` style inline or reuse an existing link style (a transparent button, accent color, no border).

- [ ] **Step 5: Run test to verify it passes** — `npm test -- Instances` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screens/Instances.tsx tests/renderer/Instances.test.tsx
git commit -m "feat(detail): make instance name open a detail view"
```

### Task 2: `InstanceDetail` shell — header + tabs

**Files:**
- Create: `src/renderer/screens/InstanceDetail.tsx`
- Modify: `src/renderer/App.tsx` (add `detailName` state; render `InstanceDetail` when set, else the list)
- Test: `tests/renderer/InstanceDetail.test.tsx`

**Interfaces:**
- Produces:
```ts
export type DetailTab = 'terminals' | 'ports' | 'monitoring'
export function InstanceDetail({ instance, onBack, onStop, onRemove }: {
  instance: InstanceView
  onBack: () => void
  onStop: (name: string) => void
  onRemove: (name: string) => void
}): JSX.Element
```
Renders the `detail-header` (name, status `badge`, workspace, agent/base, "from definition <name>" when `definitionId`, Stop [disabled unless running] + Remove actions) and the `detail-tabs` (Terminals / Ports / Monitoring) with local `useState<DetailTab>('terminals')`. Tab bodies are placeholders in this task (each tab component lands in its own phase).
- Consumes (App): `InstanceView`; existing `instances` array; `setPending` (stop/remove confirmations); a new `detailName` state.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/renderer/InstanceDetail.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InstanceDetail } from '../../src/renderer/screens/InstanceDetail'
import type { InstanceView } from '../../src/shared/types'

const inst: InstanceView = { name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'prj', tier: 'locked' }

describe('InstanceDetail', () => {
  it('shows the header, tabs, and switches tabs', () => {
    render(<InstanceDetail instance={inst} onBack={vi.fn()} onStop={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'sbx-a' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Terminals' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Ports' }))
    expect(screen.getByRole('tab', { name: 'Ports' })).toHaveAttribute('aria-selected', 'true')
  })
  it('Back and Stop/Remove call their handlers', () => {
    const onBack = vi.fn(); const onStop = vi.fn(); const onRemove = vi.fn()
    render(<InstanceDetail instance={inst} onBack={onBack} onStop={onStop} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i })); expect(onBack).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /stop/i })); expect(onStop).toHaveBeenCalledWith('sbx-a')
    fireEvent.click(screen.getByRole('button', { name: /remove/i })); expect(onRemove).toHaveBeenCalledWith('sbx-a')
  })
  it('disables Stop when not running', () => {
    render(<InstanceDetail instance={{ ...inst, status: 'stopped' }} onBack={vi.fn()} onStop={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByRole('button', { name: /stop/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `npm test -- InstanceDetail` → FAIL (module missing).

- [ ] **Step 3: Implement `InstanceDetail`** with the header + tablist (buttons `role="tab"` + `aria-selected`), Back button, Stop (`disabled={instance.status !== 'running'}`) and Remove. Tab panels render `{tab === 'terminals' && <p>…</p>}` placeholders for now. Use `TierBadge` for the tier and the `StatusBadge`/`badge` classes already used in `Instances.tsx` (reuse whatever badge component that screen uses).

- [ ] **Step 4: Wire into `App.tsx`.** Add `const [detailName, setDetailName] = useState<string | null>(null)`. In the `screen === 'instances'` block: if `detailName` and a matching instance exists, render `<InstanceDetail instance={found} onBack={() => setDetailName(null)} onStop={(n) => setPending({ kind: 'stop', name: n })} onRemove={(n) => setPending({ kind: 'remove', name: n })} />`; else render `<Instances … onOpen={setDetailName} />`. Clear `detailName` in `navigate()` (leaving the instances screen) and when a removed instance disappears from the list.

- [ ] **Step 5: Run test to verify it passes** — `npm test -- InstanceDetail` → PASS. Also `npm test -- App.launch` to confirm the App wiring didn't break existing instance tests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screens/InstanceDetail.tsx src/renderer/App.tsx tests/renderer/InstanceDetail.test.tsx
git commit -m "feat(detail): InstanceDetail shell — header + tabs + drill-in navigation"
```

---

## Phase 2 — Terminals tab (native launch + info sidebar)

### Task 3: `TerminalsTab` — launch buttons + info sidebar

**Files:**
- Create: `src/renderer/screens/detail/TerminalsTab.tsx`
- Modify: `src/renderer/screens/InstanceDetail.tsx` (render `<TerminalsTab>` on the terminals tab; fetch the spec)
- Test: `tests/renderer/detail/TerminalsTab.test.tsx`

**Interfaces:**
- Produces:
```ts
export function TerminalsTab({ instance, spec, onAttach, onShell }: {
  instance: InstanceView
  spec: DefinitionSpec | null   // null when the instance has no linked definition
  onAttach: (name: string) => void
  onShell: (name: string) => void
}): JSX.Element
```
Two-column layout (`grid-2`, `1.5fr 1fr`). **Left:** an explanatory card — "Terminals open in your native Terminal.app" — with three buttons: **Open Agent Session** (`onAttach(instance.name)`), **Open Shell Session** (`onShell(instance.name)`), each `disabled={instance.status !== 'running'}`, plus the "macOS" os-tag. (No in-app terminal — per architecture.) **Right sidebar** (`display:flex; flex-direction:column; gap`): three info cards from `spec` —
  - **Network Policy:** `<TierBadge tier={spec.definition.tier}>` + the domain `tag`s (`spec.domains`); empty-state text when none.
  - **Credentials:** grouped by kind with a `cred-type-group` + `cred-type-label` ("Service"/"Custom"), each row `service/host` name + `ENV_VAR = ••••••••` (masked; **never** a value). Service label via `serviceById`.
  - **Mounts:** each `spec.mounts` row — path (`mount-path`) + mode (`direct` / `clone (read-only)`).
  When `spec` is null, render a muted "No linked definition — details unavailable" note instead of the sidebar cards.
- Consumes: `InstanceView`, `DefinitionSpec`, `serviceById` (`@shared/services`), `TierBadge`.

- [ ] **Step 1: Add missing CSS** to `src/renderer/theme/app.css` (only if absent — `cred-type-group` was confirmed missing):

```css
.cred-type-group { margin-bottom: var(--space-3); }
.cred-type-group:last-child { margin-bottom: 0; }
.cred-type-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: var(--space-1); }
```

- [ ] **Step 2: Write the failing test**

```tsx
// tests/renderer/detail/TerminalsTab.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TerminalsTab } from '../../../src/renderer/screens/detail/TerminalsTab'
import type { InstanceView, DefinitionSpec } from '../../../src/shared/types'

const inst: InstanceView = { name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'prj', tier: 'locked' }
const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'prj', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }, { hostPath: '/shared', mode: 'clone', isPrimary: false }],
  domains: ['github.com'], ports: [], hostServices: [],
  credentials: [{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }]
}

describe('TerminalsTab', () => {
  it('launches agent and shell in the native terminal', () => {
    const onAttach = vi.fn(); const onShell = vi.fn()
    render(<TerminalsTab instance={inst} spec={spec} onAttach={onAttach} onShell={onShell} />)
    fireEvent.click(screen.getByRole('button', { name: /agent/i })); expect(onAttach).toHaveBeenCalledWith('sbx-a')
    fireEvent.click(screen.getByRole('button', { name: /shell/i })); expect(onShell).toHaveBeenCalledWith('sbx-a')
  })
  it('shows the info sidebar from the spec (tier, domains, credential, mounts)', () => {
    render(<TerminalsTab instance={inst} spec={spec} onAttach={vi.fn()} onShell={vi.fn()} />)
    expect(screen.getByText('github.com')).toBeInTheDocument()
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument()
    expect(screen.getByText('/shared')).toBeInTheDocument()
  })
  it('disables launch buttons when not running', () => {
    render(<TerminalsTab instance={{ ...inst, status: 'stopped' }} spec={spec} onAttach={vi.fn()} onShell={vi.fn()} />)
    expect(screen.getByRole('button', { name: /agent/i })).toBeDisabled()
  })
  it('degrades when there is no linked definition', () => {
    render(<TerminalsTab instance={inst} spec={null} onAttach={vi.fn()} onShell={vi.fn()} />)
    expect(screen.getByText(/no linked definition/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails** — `npm test -- TerminalsTab` → FAIL.

- [ ] **Step 4: Implement `TerminalsTab`** per the layout above. Mask helper: `'••••••••'` (never the value). Reuse `card`/`card-header`/`card-title`, `tag`, `mount-row`/`mount-path` classes.

- [ ] **Step 5: Fetch the spec in `InstanceDetail`.** Add `const [spec, setSpec] = useState<DefinitionSpec | null>(null)` + an effect: when `instance.definitionId` is set, `api.defGetSpec(instance.definitionId).then(r => r.ok && setSpec(r.data))`; else `setSpec(null)`. Render `<TerminalsTab instance={instance} spec={spec} onAttach={onAttach} onShell={onShell} />` on the terminals tab. Thread `onAttach`/`onShell` from App (the existing `instance:attach`/`instance:shell` handlers) into `InstanceDetail` as props (extend its prop type).

- [ ] **Step 6: Run test to verify it passes** — `npm test -- TerminalsTab InstanceDetail` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/screens/detail/TerminalsTab.tsx src/renderer/screens/InstanceDetail.tsx src/renderer/theme/app.css tests/renderer/detail/TerminalsTab.test.tsx
git commit -m "feat(detail): Terminals tab — native launch buttons + info sidebar"
```

---

## Phase 3 — Ports tab (live forwards)

> **Depends on Phase 0 spike** (Step 1). If `--unpublish` needs a different spec than `[host:]container/proto`, adjust Task 4's spec builder.
>
> **Scope:** port **forwards** are live (add/remove on a running sandbox). **Host services** are shown **read-only** from the spec with a note that changing them needs recreate (they're kit/allowlist config applied at create, not a live `sbx` op).

### Task 4: Adapter + IPC for live ports

**Files:**
- Modify: `src/main/sbx/adapter.ts` (add `listPorts`, `publishPort`, `unpublishPort`)
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/ipc/client.ts` (new channels)
- Modify: `src/main/sbx/parse.ts` (add `parsePortsJson`) — or inline in adapter if simpler
- Test: `tests/main/sbx/adapter-ports.test.ts`, `tests/main/ipc-ports.test.ts`

**Interfaces:**
- Produces on `SbxAdapter`:
```ts
listPorts(name: string): Promise<LivePort[]>
publishPort(name: string, port: LivePort): Promise<void>
unpublishPort(name: string, port: LivePort): Promise<void>
// where (add to @shared/types):
export interface LivePort { hostPort: number | null; containerPort: number; protocol: string }
```
`listPorts` runs `sbx ports <name> --json` and parses to `LivePort[]` (field names per the spike). `publishPort`/`unpublishPort` build the spec with `portIntentToPublishSpec({ ...port, label: '' })` and run `sbx ports <name> --publish|--unpublish <spec>`.
- IPC channels (all `Result<T>`): `'instance:ports:list' (name) → LivePort[]`, `'instance:ports:publish' (name, port) → null`, `'instance:ports:unpublish' (name, port) → null`.

- [ ] **Step 1: Add the `LivePort` type** to `src/shared/types.ts` and a test `tests/shared/types-liveport.test.ts` asserting it accepts `{ hostPort: null, containerPort: 3000, protocol: 'tcp' }`. Run `npm test -- types-liveport` (fails → add type → passes).

- [ ] **Step 2: Write the failing adapter test**

```ts
// tests/main/sbx/adapter-ports.test.ts
import { describe, it, expect } from 'vitest'
import { createSbxAdapter, type SpawnFn } from '../../../src/main/sbx/adapter'

function fake(stdout = '') {
  const calls: string[][] = []
  const spawn: SpawnFn = (_c, args) => { calls.push(args); return Promise.resolve({ stdout, stderr: '', code: 0 }) }
  return { spawn, calls }
}

describe('adapter live ports', () => {
  it('publishes a port with the full spec', async () => {
    const { spawn, calls } = fake()
    await createSbxAdapter(spawn).publishPort('box', { hostPort: 8080, containerPort: 3000, protocol: 'tcp' })
    expect(calls[0]).toEqual(['ports', 'box', '--publish', '8080:3000/tcp'])
  })
  it('unpublishes a port', async () => {
    const { spawn, calls } = fake()
    await createSbxAdapter(spawn).unpublishPort('box', { hostPort: 8080, containerPort: 3000, protocol: 'tcp' })
    expect(calls[0]).toEqual(['ports', 'box', '--unpublish', '8080:3000/tcp'])
  })
  it('lists ports from --json', async () => {
    // adjust the JSON shape to the spike finding
    const { spawn } = fake(JSON.stringify({ ports: [{ host_port: 8080, sandbox_port: 3000, protocol: 'tcp' }] }))
    const ports = await createSbxAdapter(spawn).listPorts('box')
    expect(ports).toEqual([{ hostPort: 8080, containerPort: 3000, protocol: 'tcp' }])
  })
})
```

- [ ] **Step 3: Run → FAIL** (`npm test -- adapter-ports`). **Step 4: Implement** the three adapter methods + a `parsePortsJson(stdout): LivePort[]` (tolerate the `{ports:[…]}` envelope and a bare array, mirroring `parseSbxLsJson`; map field names per the spike). Add the three methods to the `SbxAdapter` interface and returned object.

- [ ] **Step 5: Fix widened-interface mocks.** Adding to `SbxAdapter` breaks partial mocks. Add stub methods `listPorts: async () => [], publishPort: async () => {}, unpublishPort: async () => {}` to the adapter mocks in `tests/main/ipc.test.ts`, `tests/main/ipc-definitions.test.ts`, `tests/main/ipc-lifecycle.test.ts`, `tests/main/reconciler.test.ts` (same pattern used when `setSecret`/`setCustomSecret` were added).

- [ ] **Step 6: Write the failing IPC test** (`tests/main/ipc-ports.test.ts`) exercising the three handlers with a fake adapter, then **implement** the handlers in `buildHandlers` (`wrap(async () => deps.adapter.listPorts(name))`, etc.), register them in `registerIpc`, add to preload (`instancePortsList/Publish/Unpublish`) and the client `Api` interface + fallback. Run `npm test -- ipc-ports` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/sbx/adapter.ts src/main/sbx/parse.ts src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/
git commit -m "feat(detail): sbx live port list/publish/unpublish via adapter + IPC"
```

### Task 5: `PortsTab` — live forwards + read-only host services

**Files:**
- Create: `src/renderer/screens/detail/PortsTab.tsx`
- Modify: `src/renderer/screens/InstanceDetail.tsx` (render `<PortsTab>` on the ports tab)
- Test: `tests/renderer/detail/PortsTab.test.tsx`

**Interfaces:**
```ts
export function PortsTab({ instance, spec, ports, onPublish, onUnpublish }: {
  instance: InstanceView
  spec: DefinitionSpec | null           // for read-only host services
  ports: LivePort[]                     // live forwards (from api.instancePortsList)
  onPublish: (port: LivePort) => void
  onUnpublish: (port: LivePort) => void
}): JSX.Element
```
**Port Forwarding card:** the `ports` list (each `host→container/proto` + a ✕ → `onUnpublish(port)`), an add form (mono port input + protocol select TCP/TCP4/TCP6 + label + **Forward** → `parsePort` the input → `onPublish({ hostPort, containerPort, protocol })`), and the "forwarded to 127.0.0.1 … post-run operation" helper. Empty-state when no forwards. **Access Host Services card (read-only):** each `spec.hostServices` row (`host.docker.internal:<port>` + `Allowlist: localhost:<port>`) + a muted note "Host services are set on the definition; recreate the sandbox to change them." (No live add/remove — out of scope.)
- Consumes: `LivePort`, `parsePort` (`@shared/…` — export from `draft.ts` or move to `@shared`), `PortProtocol`.

> Note: `parsePort` currently lives in `src/renderer/wizard/draft.ts`. Import it from there (renderer→renderer is fine), or lift it to a shared util if preferred.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/renderer/detail/PortsTab.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortsTab } from '../../../src/renderer/screens/detail/PortsTab'
import type { InstanceView, DefinitionSpec, LivePort } from '../../../src/shared/types'

const inst: InstanceView = { name: 'box', status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'p', tier: 'locked' }
const ports: LivePort[] = [{ hostPort: 8080, containerPort: 3000, protocol: 'tcp' }]

describe('PortsTab', () => {
  it('lists a forward and removes it', () => {
    const onUnpublish = vi.fn()
    render(<PortsTab instance={inst} spec={null} ports={ports} onPublish={vi.fn()} onUnpublish={onUnpublish} />)
    expect(screen.getByText(/8080/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remove forward/i }))
    expect(onUnpublish).toHaveBeenCalledWith(ports[0])
  })
  it('adds a forward from the input + protocol', () => {
    const onPublish = vi.fn()
    render(<PortsTab instance={inst} spec={null} ports={[]} onPublish={onPublish} onUnpublish={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Port mapping'), { target: { value: '9229:9229' } })
    fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'tcp6' } })
    fireEvent.click(screen.getByRole('button', { name: /forward/i }))
    expect(onPublish).toHaveBeenCalledWith({ hostPort: 9229, containerPort: 9229, protocol: 'tcp6' })
  })
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement `PortsTab`** (reuse the `.port-row`/`.port-proto`/`.port-status` CSS; add `.port-proto` to app.css if the ports work didn't — confirmed missing). **Step 4:** wire into `InstanceDetail`: hold `const [livePorts, setLivePorts] = useState<LivePort[]>([])`, load via `api.instancePortsList(instance.name)` when the tab opens and after each publish/unpublish; `onPublish`/`onUnpublish` call the IPC then reload. **Step 5:** `npm test -- PortsTab InstanceDetail` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screens/detail/PortsTab.tsx src/renderer/screens/InstanceDetail.tsx src/renderer/theme/app.css tests/renderer/detail/PortsTab.test.tsx
git commit -m "feat(detail): Ports tab — live forwards (add/remove) + read-only host services"
```

---

## Phase 4 — Monitoring tab (policy log)

> **Depends on Phase 0 spike** (Step 2). If `sbx policy log` has no `--json`, the parser consumes the **text table** (columns SANDBOX / TYPE / HOST / PROXY / RULE / REASON / LAST SEEN / COUNT + an "Allowed requests:" section). If there's no stream mode, the tab **polls** on an interval.

### Task 6: Policy-log parser + adapter + IPC

**Files:**
- Create: `src/main/sbx/policy-log.ts` (pure parser)
- Modify: `src/main/sbx/adapter.ts` (`policyLog(name?)`), `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/ipc/client.ts`
- Test: `tests/main/sbx/policy-log.test.ts`, `tests/main/ipc-monitoring.test.ts`

**Interfaces:**
- Produces (add to `@shared/types`):
```ts
export interface PolicyEvent { at: string; host: string; allowed: boolean; reason: string }
export interface PolicySummary { allowed: number; blocked: number; events: PolicyEvent[] }
```
- `parsePolicyLog(raw: string, opts: { json: boolean }): PolicySummary` — pure; parses JSON rows (spike shape) or the text table into events, computes `allowed`/`blocked` counts.
- `SbxAdapter.policyLog(name?: string): Promise<PolicySummary>` → runs `sbx policy log [<name>] [--json]` and returns `parsePolicyLog(...)`.
- IPC: `'instance:policyLog' (name) → PolicySummary`.

- [ ] **Step 1: Write the failing parser test** — feed a representative raw sample (from the spike; both a JSON sample if available and the text-table sample) and assert `allowed`/`blocked` counts + event `{ host, allowed, reason }`. Example (text form):

```ts
// tests/main/sbx/policy-log.test.ts
import { describe, it, expect } from 'vitest'
import { parsePolicyLog } from '../../../src/main/sbx/policy-log'

const sample = `Allowed requests:
SANDBOX  TYPE     HOST                   PROXY          RULE  REASON          LAST SEEN  COUNT
box      network  api.anthropic.com:443  forward-bypass       domain-allowed  10:15:23   6
box      network  telemetry.example:443  forward              default-deny    10:15:15   1`

describe('parsePolicyLog (text)', () => {
  it('splits allowed vs blocked by reason and returns events', () => {
    const s = parsePolicyLog(sample, { json: false })
    expect(s.allowed).toBe(1)  // domain-allowed
    expect(s.blocked).toBe(1)  // default-deny
    expect(s.events.some((e) => e.host.includes('api.anthropic.com') && e.allowed)).toBe(true)
    expect(s.events.some((e) => e.host.includes('telemetry') && !e.allowed)).toBe(true)
  })
})
```

> Correct the sample + the allowed/blocked rule to the spike's real output. The heuristic: a row is `blocked` when its reason/rule indicates denial (`default-deny`, `no matching allow`, "No matching allow rule"); otherwise `allowed`. If `--json` exists, prefer a boolean/action field over reason-string matching.

- [ ] **Step 2: Run → FAIL. Step 3: Implement `parsePolicyLog`** (pure; tolerate empty input → `{ allowed: 0, blocked: 0, events: [] }`). **Step 4: Implement `adapter.policyLog`** (+ interface + returned object; add stub `policyLog: async () => ({ allowed: 0, blocked: 0, events: [] })` to the partial-mock adapters). **Step 5: IPC** handler + register + preload (`instancePolicyLog`) + client `Api`. Run `npm test -- policy-log ipc-monitoring` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/sbx/policy-log.ts src/main/sbx/adapter.ts src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/
git commit -m "feat(detail): sbx policy-log parser + adapter + IPC"
```

### Task 7: `MonitoringTab` — counters + traffic log

**Files:**
- Create: `src/renderer/screens/detail/MonitoringTab.tsx`
- Modify: `src/renderer/screens/InstanceDetail.tsx` (render `<MonitoringTab>`; poll while the tab is open; surface a blocked-count badge on the tab)
- Test: `tests/renderer/detail/MonitoringTab.test.tsx`

**Interfaces:**
```ts
export function MonitoringTab({ summary }: { summary: PolicySummary }): JSX.Element
```
Renders the `mon-summary` counters (Allowed / Blocked / and, if available, Domains allowlisted from the spec) using `mon-stat` / `mon-stat-value allowed|blocked`, and a live-traffic list — each `PolicyEvent` as a row: a ✓/✕ marker (`traffic-allowed`/`traffic-blocked`), host, reason, time. Empty-state when no events.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/renderer/detail/MonitoringTab.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MonitoringTab } from '../../../src/renderer/screens/detail/MonitoringTab'

describe('MonitoringTab', () => {
  it('shows counters and traffic rows', () => {
    render(<MonitoringTab summary={{ allowed: 42, blocked: 3, events: [
      { at: '10:15:23', host: 'api.anthropic.com', allowed: true, reason: 'domain-allowed' },
      { at: '10:15:15', host: 'telemetry.example.com', allowed: false, reason: 'default-deny' }
    ] }} />)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('api.anthropic.com')).toBeInTheDocument()
    expect(screen.getByText('telemetry.example.com')).toBeInTheDocument()
  })
  it('shows an empty state with no events', () => {
    render(<MonitoringTab summary={{ allowed: 0, blocked: 0, events: [] }} />)
    expect(screen.getByText(/no.*traffic/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement `MonitoringTab`** (reuse `mon-summary`/`mon-stat`/`mon-stat-value`, `traffic-table` classes). **Step 4:** wire into `InstanceDetail`: `const [summary, setSummary] = useState<PolicySummary>({ allowed: 0, blocked: 0, events: [] })`; when the monitoring tab is active, load `api.instancePolicyLog(instance.name)` and poll every ~5s (clear the interval on tab change/unmount). Show the blocked count as a `nav-badge` on the Monitoring tab (like the mockup's red badge) — derive from the last-loaded `summary.blocked`. **Step 5:** `npm test -- MonitoringTab` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screens/detail/MonitoringTab.tsx src/renderer/screens/InstanceDetail.tsx tests/renderer/detail/MonitoringTab.test.tsx
git commit -m "feat(detail): Monitoring tab — allowed/blocked counters + traffic log (polled)"
```

---

## Phase 5 — i18n + finalize

### Task 8: i18n for the detail screen (en + de)

**Files:** Modify `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`

Add a `detail` namespace covering every visible string across the shell + three tabs: `back`, `stop`, `remove`, `fromDefinition`, tab labels (`tabTerminals`/`tabPorts`/`tabMonitoring`), Terminals (`openAgent`, `openShell`, `nativeNote`, `networkPolicy`, `credentials`, `mounts`, `noDefinition`), Ports (`portForwarding`, `addForward`, `postRunNote`, `hostServices`, `hostServicesReadonly`, `noForwards`), Monitoring (`allowedRequests`, `blockedRequests`, `domainsAllowlisted`, `liveTraffic`, `noTraffic`). Keep `de: Dict` parity (typecheck enforces it). Replace the literal strings in the four detail components with `t('detail.*')`, keeping `aria-label`s literal where tests assert them.

- [ ] **Step 1:** Add keys to `en.ts`, translate in `de.ts`, wire `t()` into the components. **Step 2:** `npm run typecheck` (Dict parity) → clean. **Step 3:** `npm test` → all PASS. **Step 4: Commit**

```bash
git add src/renderer/i18n/en.ts src/renderer/i18n/de.ts src/renderer/screens/InstanceDetail.tsx src/renderer/screens/detail/
git commit -m "i18n(detail): sandbox instance detail strings (en/de)"
```

### Task 9: Green suite + build + manual check

- [ ] **Step 1:** `npm test` → all PASS (fix any partial-mock adapter still missing the new methods). **Step 2:** `npm run typecheck && npm run build` → clean + build succeeds.
- [ ] **Step 3: Manual check** — `npm run dev` (full restart, main changed). From Instances, click an instance name → detail opens. Terminals: Open Agent / Open Shell launch native terminals; sidebar shows the definition's policy/credentials/mounts. Ports: add `18080:18080` → appears + `sbx ports <name>` confirms; remove it → gone. Monitoring: run some traffic in the sandbox, confirm allowed/blocked counters + rows update on the poll; the Monitoring tab shows a blocked badge. Back returns to the list.
- [ ] **Step 4:** Use superpowers:finishing-a-development-branch to complete.

---

## Self-Review

**Spec coverage (v8 detail screen, `index.html` §screen-detail):**
- Header (name, status, workspace, base, from-definition link, Stop/Remove) → Task 2. ✓
- Three tabs (Terminals/Ports/Monitoring) → Task 2 shell; Tasks 3/5/7 bodies. ✓
- Terminals: native launch (Agent/Shell/host) + Network Policy / Credentials / Mounts sidebar → Task 3. ✓ (In-app terminals intentionally **out** per scope decision — replaced by native launch buttons.)
- Ports: live Port Forwarding add/remove → Tasks 4–5. ✓ Host services shown **read-only** (live change out of scope — noted). ✓
- Monitoring: allowed/blocked counters + live traffic log + blocked badge → Tasks 6–7. ✓
- Drill-in from Instances list → Task 1. ✓
- i18n → Task 8. ✓

**Placeholder scan:** No "TBD"/"handle edge cases". Two tabs (3-body Ports, Monitoring) are explicitly spike-gated with named fallbacks (unpublish spec; JSON-vs-text parse, poll-vs-stream). The policy-log sample + host-service-live scope are called out for correction against the spike.

**Type consistency:** `LivePort { hostPort: number|null; containerPort: number; protocol: string }`, `PolicyEvent { at; host; allowed; reason }`, `PolicySummary { allowed; blocked; events }`, `DetailTab = 'terminals'|'ports'|'monitoring'` defined once and consumed identically across adapter/IPC/tabs. `InstanceDetail` props `{ instance, onBack, onStop, onRemove, onAttach, onShell }` (onAttach/onShell added in Task 3). Reuses existing `InstanceView`, `DefinitionSpec`, `TierBadge`, `serviceById`, `parsePort`, `portIntentToPublishSpec`.

**Known risks:** widening `SbxAdapter` breaks partial mocks (Tasks 4/6 each list the mock files to patch — same pattern as the credentials work); `sbx policy log` format is the biggest unknown (spike Step 2 + text-table fallback); monitoring polling interval is a guess (~5s) — tune after the manual check.

---

## Execution Handoff

Two options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between. Best for a 9-task, multi-subsystem screen.
2. **Inline Execution** — batch with checkpoints.

**Phase 0 (the spike) runs first** — it needs a running `sbx` sandbox on the developer's machine and gates Phases 3–4. Which approach?
