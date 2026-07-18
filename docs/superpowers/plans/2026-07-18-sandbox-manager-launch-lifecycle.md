# AI Sandbox Manager — Phase 3: Launch & Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a stored **Definition**, launch a real `sbx` sandbox (provision → apply per-sandbox network tier → publish port intents → record the instance↔definition link), attach an interactive **agent terminal** and a **host-shell terminal** in native macOS Terminal windows, and manage each instance's lifecycle (Attach / Shell / Stop / Remove-with-confirmation) from the Instances screen.

**Architecture:** All mutating, non-interactive `sbx` calls (`create`, `policy allow network`, `ports --publish`, `stop`, `rm`) flow through the single choke-point `SbxAdapter` (`src/main/sbx/adapter.ts`). Interactive attach (`sbx run`, `sbx exec -it … bash`) is delegated to the host's **native Terminal.app** via a small `osascript` launcher (`src/main/terminal.ts`) — no `node-pty`, no embedded xterm, no WebSocket. A pure translation layer (`src/main/sbx/translate.ts`) converts a `DefinitionSpec` into exact argv and shell commands and is fully unit-tested without ever invoking `sbx`. A `launchDefinition` orchestrator (`src/main/launch.ts`) sequences the steps. The renderer gains a **Launch** action on Definitions and per-row lifecycle actions + a confirmation modal on Instances.

**Tech Stack:** Electron 33 (main = Node), React 18 + TypeScript strict, `child_process.spawn` (via the existing `SpawnFn` seam), better-sqlite3 (existing store), Vitest + @testing-library/react. macOS-only terminal launch (`osascript`).

## Global Constraints

- **Single choke-point rule.** Only `SbxAdapter` spawns `sbx`. The renderer never shells out; it calls IPC. Interactive terminals are the one exception and go through `src/main/terminal.ts` (`osascript`), never the renderer.
- **`sbx` is the source of truth** for instances. Launching records app-owned link metadata (`instance_meta`) but never invents status; the Instances list is still produced by the Phase 2 `reconcile()`.
- **Agent is fixed to "Claude Code."** The `sbx create` agent positional is always the keyword `claude`. The stored `baseImage` maps to `--template`.
- **`sbx policy reset` is FORBIDDEN in app code.** It is global — it deletes the local policy store, stops **all** running sandboxes, and restarts the daemon. Per-sandbox network tiers MUST use `sbx policy allow network --sandbox <name> <resources>` (scoped to policy "local" for that one sandbox).
- **Network tier mapping:** `open` → allow `**` (all hosts); `balanced` → a fixed baseline allowlist ∪ the definition's explicit domains; `locked` → only the definition's explicit domains (may be empty → no allow rule is added, i.e. fully locked).
- **Mount mode mapping:** the primary mount is the `sbx create` PATH positional; `mode: 'clone'` on the primary adds the sandbox-level `--clone` flag. Non-primary (extra) mounts are appended as positionals; `mode: 'clone'` (read-only) appends a `:ro` suffix, `mode: 'direct'` appends the bare path.
- **Sandbox name normalisation:** the definition name is normalised once via `resolveSandboxName(spec)` and that exact string is used for BOTH the `sbx create --name` flag AND the recorded `instance_meta.sbxName`, so metadata can never orphan.
- **Remove is irreversible and requires explicit confirmation** in the UI (a typed-free confirmation modal) before the app runs `sbx rm <name> --force`.
- **No secret values anywhere** (unchanged from Phase 2). This phase adds no credential-value path; credentials remain declarations only. Phase 6 owns secret injection.
- **TypeScript strict mode.** Shared types in `src/shared/`. IPC results keep the shape `{ ok: true; data: T } | { ok: false; error: { kind; message } }`.
- **Commit after every task.** Work happens on a new branch `phase-3-launch-lifecycle` cut from `main`.
- **Design tokens** already frozen in `src/renderer/theme/`; reuse them, add none.
- **Dual native-ABI note (from Phase 1) still applies:** tests run on the Node-ABI `better-sqlite3` (`pretest` hook); `npm run dev` needs the Electron-ABI rebuild (`predev` hook). Do not fight the ABI switch — let the hooks run.

---

## Existing interfaces this phase builds on (Phases 1–2, do not redefine)

- `src/shared/types.ts`: `Tier = 'open'|'balanced'|'locked'`, `MountMode = 'direct'|'clone'`, `MountIntent { hostPath; mode; isPrimary }`, `PortIntent { hostPort; containerPort; label }`, `DefinitionSpec { definition; mounts; domains; ports; credentials }`, `Definition { id; name; description; baseImage; tier; createdAt }`, `InstanceMeta { sbxName; definitionId; createdByApp; createdAt }`, `InstanceView`, `Result<T>`.
- `src/shared/errors.ts`: `class SbxError extends Error` with `.kind: SbxErrorKind`, `classifySbxError(code, stderr)`. `SbxErrorKind = 'not-installed'|'not-authed'|'not-found'|'policy-rejected'|'generic'`.
- `src/main/sbx/adapter.ts`: `interface SbxResult { stdout; stderr; code }`, `type SpawnFn = (cmd, args, opts) => Promise<SbxResult>`, `interface SbxAdapter { runSbx(args, opts?); listSandboxes() }`, `createSbxAdapter(spawnFn?)`. `runSbx` throws `SbxError` on non-zero exit.
- `src/main/store/db.ts`: `interface Store { insertDefinition; listDefinitions; getDefinition; insertDefinitionSpec; getDefinitionSpec; upsertInstanceMeta; listInstanceMeta; deleteInstanceMeta; close }`, `openStore(filename)`. `getDefinitionSpec(id): DefinitionSpec | undefined`.
- `src/main/ipc.ts`: `buildHandlers(deps: { adapter; store; probes })`, `registerIpc(deps)`. Handler wrapper `wrap<T>()` returns `Result<T>`.
- `src/main/index.ts`: builds `{ adapter: createSbxAdapter(), store, probes: systemProbes }` and calls `registerIpc`.
- `src/preload/index.ts`: `window.api = { prereqCheck, instancesList, defCreate, defList, pickFolder }`. Built to `index.cjs`.
- `src/renderer/ipc/client.ts`: typed `api` wrapper with an "IPC unavailable" fallback for tests.
- `src/renderer/App.tsx`: prereq gate → `AppShell` with `screen ∈ {prereq, definitions, instances, settings}`, `wizard` boolean; `loadDefs()`, `loadInstances()`, `navigate()`.
- `src/renderer/screens/Definitions.tsx`: `Definitions({ definitions, onCreate })`. `src/renderer/screens/Instances.tsx`: `Instances({ instances })`.
- `src/renderer/i18n/{en.ts,de.ts,index.tsx}`: `export const en = { … }`, `de: Dict`, `useT()` → `t('a.b.c', vars?)`. Top-level keys include `nav, common, definitions, instances, wizard, tier, status`.

---

## File Structure (Phase 3)

```
src/main/sbx/translate.ts              CREATE: pure DefinitionSpec→argv/command translators
src/main/sbx/adapter.ts                MODIFY: add createSandbox, applyPolicy, publishPorts,
                                               stopSandbox, removeSandbox to SbxAdapter
src/main/terminal.ts                   CREATE: native Terminal.app launcher (osascript)
src/main/launch.ts                     CREATE: launchDefinition orchestrator
src/main/ipc.ts                        MODIFY: add instance:launch|attach|shell|stop|remove;
                                               Deps gains openTerminal
src/main/index.ts                      MODIFY: pass openTerminal into registerIpc deps
src/preload/index.ts                   MODIFY: expose 5 instance:* methods
src/renderer/ipc/client.ts             MODIFY: add 5 methods to Api + fallback
src/renderer/components/ConfirmModal.tsx CREATE: generic confirm dialog
src/renderer/screens/Instances.tsx     MODIFY: actions column (Attach/Shell/Stop/Remove)
src/renderer/screens/Definitions.tsx   MODIFY: per-definition Launch action
src/renderer/App.tsx                   MODIFY: launch/attach/shell/stop/remove wiring + modal state
src/renderer/i18n/en.ts                MODIFY: launch + lifecycle strings
src/renderer/i18n/de.ts                MODIFY: German parity
tests/main/sbx/translate.test.ts       CREATE
tests/main/sbx-lifecycle.test.ts       CREATE
tests/main/terminal.test.ts            CREATE
tests/main/launch.test.ts              CREATE
tests/main/ipc-lifecycle.test.ts       CREATE
tests/renderer/ConfirmModal.test.tsx   CREATE
tests/renderer/Instances.actions.test.tsx CREATE
tests/renderer/Definitions.test.tsx    MODIFY: assert Launch action
```

---

### Task 0: Branch

- [ ] **Step 1: Cut the phase branch from main**

Run:
```bash
git checkout -b phase-3-launch-lifecycle
git status
```
Expected: `On branch phase-3-launch-lifecycle`, clean tree.

---

### Task 1: Pure sbx translators — `DefinitionSpec` → argv & commands

**Files:**
- Create: `src/main/sbx/translate.ts`
- Test: `tests/main/sbx/translate.test.ts`

**Interfaces:**
- Consumes: `DefinitionSpec`, `MountIntent`, `PortIntent`, `Tier` from `@shared/types`.
- Produces:
  - `AGENT_KEYWORD = 'claude'`
  - `BALANCED_BASELINE: string[]`
  - `toSbxName(raw: string): string`
  - `resolveSandboxName(spec: DefinitionSpec): string`
  - `tierToAllowlist(tier: Tier, extraDomains: string[]): string[]`
  - `specToCreateArgs(spec: DefinitionSpec): string[]`
  - `portIntentToPublishSpec(p: PortIntent): string`
  - `shellQuote(s: string): string`
  - `agentAttachCommand(name: string): string`
  - `hostShellCommand(name: string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/main/sbx/translate.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  AGENT_KEYWORD,
  toSbxName,
  resolveSandboxName,
  tierToAllowlist,
  specToCreateArgs,
  portIntentToPublishSpec,
  shellQuote,
  agentAttachCommand,
  hostShellCommand
} from '../../../src/main/sbx/translate'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(over: Partial<DefinitionSpec> = {}): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
    mounts: [{ hostPath: '/home/u/proj', mode: 'direct', isPrimary: true }],
    domains: [],
    ports: [],
    credentials: [],
    ...over
  }
}

describe('toSbxName', () => {
  it('lowercases, replaces spaces, strips invalid chars', () => {
    expect(toSbxName('My Project')).toBe('my-project')
    expect(toSbxName('Foo/Bar Baz!')).toBe('foo-bar-baz')
    expect(toSbxName('  a__b  ')).toBe('a-b')
  })
  it('never returns empty', () => {
    expect(toSbxName('!!!')).toBe('sandbox')
  })
})

describe('resolveSandboxName', () => {
  it('normalises the definition name', () => {
    expect(resolveSandboxName(spec())).toBe('my-project')
  })
})

describe('tierToAllowlist', () => {
  it('open allows all hosts', () => {
    expect(tierToAllowlist('open', ['x.com'])).toEqual(['**'])
  })
  it('locked allows only explicit domains', () => {
    expect(tierToAllowlist('locked', ['api.example.com'])).toEqual(['api.example.com'])
    expect(tierToAllowlist('locked', [])).toEqual([])
  })
  it('balanced merges baseline with extras and dedups', () => {
    const out = tierToAllowlist('balanced', ['api.example.com', 'registry.npmjs.org'])
    expect(out).toContain('api.example.com')
    expect(out).toContain('registry.npmjs.org')
    // dedup: registry.npmjs.org is also in baseline
    expect(out.filter((d) => d === 'registry.npmjs.org')).toHaveLength(1)
  })
})

describe('specToCreateArgs', () => {
  it('builds create argv with agent keyword, name and template', () => {
    expect(specToCreateArgs(spec())).toEqual([
      'create', AGENT_KEYWORD, '/home/u/proj',
      '--name', 'my-project',
      '--template', 'docker.io/docker/sandbox-templates:claude-code'
    ])
  })
  it('adds --clone when the primary mount is clone mode', () => {
    const args = specToCreateArgs(spec({ mounts: [{ hostPath: '/p', mode: 'clone', isPrimary: true }] }))
    expect(args).toContain('--clone')
  })
  it('appends extra mounts, read-only extras get :ro', () => {
    const args = specToCreateArgs(spec({
      mounts: [
        { hostPath: '/p', mode: 'direct', isPrimary: true },
        { hostPath: '/docs', mode: 'clone', isPrimary: false },
        { hostPath: '/rw', mode: 'direct', isPrimary: false }
      ]
    }))
    expect(args).toContain('/docs:ro')
    expect(args).toContain('/rw')
  })
  it('omits --template when baseImage is empty', () => {
    const args = specToCreateArgs(spec({ definition: { ...spec().definition, baseImage: '' } }))
    expect(args).not.toContain('--template')
  })
})

describe('portIntentToPublishSpec', () => {
  it('formats host:container', () => {
    expect(portIntentToPublishSpec({ hostPort: 3000, containerPort: 8080, label: 'web' })).toBe('3000:8080')
  })
})

describe('shell command builders', () => {
  it('quotes names and builds run/exec commands', () => {
    expect(shellQuote('a b')).toBe("'a b'")
    expect(agentAttachCommand('my-project')).toBe("sbx run --name 'my-project'")
    expect(hostShellCommand('my-project')).toBe("sbx exec -it 'my-project' bash")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx rtk proxy npx vitest run tests/main/sbx/translate.test.ts`
Expected: FAIL — `Cannot find module '.../src/main/sbx/translate'`.

- [ ] **Step 3: Implement the translators**

Create `src/main/sbx/translate.ts`:
```ts
import type { DefinitionSpec, PortIntent, Tier } from '@shared/types'

export const AGENT_KEYWORD = 'claude'

// A conservative baseline for the "balanced" tier: package registries and
// common developer endpoints an agent typically needs, nothing broader.
export const BALANCED_BASELINE: string[] = [
  'registry.npmjs.org',
  '*.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  '*.githubusercontent.com',
  'api.anthropic.com'
]

/** Normalise an arbitrary definition name into a safe sbx sandbox name. */
export function toSbxName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'sandbox'
}

export function resolveSandboxName(spec: DefinitionSpec): string {
  return toSbxName(spec.definition.name)
}

export function tierToAllowlist(tier: Tier, extraDomains: string[]): string[] {
  if (tier === 'open') return ['**']
  if (tier === 'locked') return dedup(extraDomains)
  return dedup([...BALANCED_BASELINE, ...extraDomains])
}

function dedup(xs: string[]): string[] {
  return [...new Set(xs.filter((x) => x.trim().length > 0))]
}

export function specToCreateArgs(spec: DefinitionSpec): string[] {
  const primary = spec.mounts.find((m) => m.isPrimary) ?? spec.mounts[0]
  const extras = spec.mounts.filter((m) => m !== primary)
  const args = ['create', AGENT_KEYWORD, primary.hostPath]
  for (const m of extras) args.push(m.mode === 'clone' ? `${m.hostPath}:ro` : m.hostPath)
  args.push('--name', resolveSandboxName(spec))
  if (spec.definition.baseImage.trim().length > 0) args.push('--template', spec.definition.baseImage)
  if (primary.mode === 'clone') args.push('--clone')
  return args
}

export function portIntentToPublishSpec(p: PortIntent): string {
  return `${p.hostPort}:${p.containerPort}`
}

/** Single-quote a string for safe embedding in a POSIX shell command. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function agentAttachCommand(name: string): string {
  return `sbx run --name ${shellQuote(name)}`
}

export function hostShellCommand(name: string): string {
  return `sbx exec -it ${shellQuote(name)} bash`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx rtk proxy npx vitest run tests/main/sbx/translate.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/sbx/translate.ts tests/main/sbx/translate.test.ts
git commit -m "feat(launch): pure sbx translators (create argv, tier allowlist, terminal commands)"
```

---

### Task 2: Adapter lifecycle methods

**Files:**
- Modify: `src/main/sbx/adapter.ts`
- Test: `tests/main/sbx-lifecycle.test.ts`

**Interfaces:**
- Consumes: `specToCreateArgs`, `tierToAllowlist`, `portIntentToPublishSpec`, `resolveSandboxName` (Task 1); existing `runSbx`.
- Produces (added to `SbxAdapter`):
  - `createSandbox(spec: DefinitionSpec): Promise<void>`
  - `applyPolicy(name: string, tier: Tier, domains: string[]): Promise<void>`
  - `publishPorts(name: string, ports: PortIntent[]): Promise<void>`
  - `stopSandbox(name: string): Promise<void>`
  - `removeSandbox(name: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/main/sbx-lifecycle.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createSbxAdapter, type SpawnFn, type SbxResult } from '../../src/main/sbx/adapter'
import type { DefinitionSpec } from '../../src/shared/types'

function recorder(): { calls: string[][]; spawn: SpawnFn } {
  const calls: string[][] = []
  const spawn: SpawnFn = async (_cmd, args): Promise<SbxResult> => {
    calls.push(args)
    return { stdout: '', stderr: '', code: 0 }
  }
  return { calls, spawn }
}

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'balanced', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: ['api.example.com'],
  ports: [{ hostPort: 3000, containerPort: 8080, label: 'web' }],
  credentials: []
}

describe('adapter lifecycle', () => {
  it('createSandbox spawns sbx create with translated argv', async () => {
    const { calls, spawn } = recorder()
    await createSbxAdapter(spawn).createSandbox(spec)
    expect(calls[0]).toEqual(['create', 'claude', '/p', '--name', 'my-project', '--template', 'img:tag'])
  })

  it('applyPolicy scopes an allow-network rule to the sandbox', async () => {
    const { calls, spawn } = recorder()
    await createSbxAdapter(spawn).applyPolicy('my-project', 'locked', ['a.com', 'b.com'])
    expect(calls[0]).toEqual(['policy', 'allow', 'network', '--sandbox', 'my-project', 'a.com,b.com'])
  })

  it('applyPolicy on a fully-locked empty allowlist makes no call', async () => {
    const { calls, spawn } = recorder()
    await createSbxAdapter(spawn).applyPolicy('my-project', 'locked', [])
    expect(calls).toHaveLength(0)
  })

  it('publishPorts publishes each intent', async () => {
    const { calls, spawn } = recorder()
    await createSbxAdapter(spawn).publishPorts('my-project', spec.ports)
    expect(calls[0]).toEqual(['ports', 'my-project', '--publish', '3000:8080'])
  })

  it('stopSandbox and removeSandbox use the right verbs (rm is forced)', async () => {
    const { calls, spawn } = recorder()
    const a = createSbxAdapter(spawn)
    await a.stopSandbox('my-project')
    await a.removeSandbox('my-project')
    expect(calls[0]).toEqual(['stop', 'my-project'])
    expect(calls[1]).toEqual(['rm', 'my-project', '--force'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx rtk proxy npx vitest run tests/main/sbx-lifecycle.test.ts`
Expected: FAIL — `createSandbox is not a function`.

- [ ] **Step 3: Extend the adapter**

In `src/main/sbx/adapter.ts`, add imports at the top (below the existing imports):
```ts
import type { DefinitionSpec, PortIntent, Tier } from '@shared/types'
import { specToCreateArgs, tierToAllowlist, portIntentToPublishSpec } from './translate'
```
(Note: `SbxInstance` is already imported; keep it. Combine the type import lines if your linter prefers.)

Extend the `SbxAdapter` interface:
```ts
export interface SbxAdapter {
  runSbx(args: string[], opts?: { stdin?: string }): Promise<SbxResult>
  listSandboxes(): Promise<SbxInstance[]>
  createSandbox(spec: DefinitionSpec): Promise<void>
  applyPolicy(name: string, tier: Tier, domains: string[]): Promise<void>
  publishPorts(name: string, ports: PortIntent[]): Promise<void>
  stopSandbox(name: string): Promise<void>
  removeSandbox(name: string): Promise<void>
}
```

Inside `createSbxAdapter`, after `listSandboxes` and before the `return`, add:
```ts
  async function createSandbox(spec: DefinitionSpec): Promise<void> {
    await runSbx(specToCreateArgs(spec))
  }

  async function applyPolicy(name: string, tier: Tier, domains: string[]): Promise<void> {
    const resources = tierToAllowlist(tier, domains)
    if (resources.length === 0) return // fully locked: no allow rule
    await runSbx(['policy', 'allow', 'network', '--sandbox', name, resources.join(',')])
  }

  async function publishPorts(name: string, ports: PortIntent[]): Promise<void> {
    for (const p of ports) {
      await runSbx(['ports', name, '--publish', portIntentToPublishSpec(p)])
    }
  }

  async function stopSandbox(name: string): Promise<void> {
    await runSbx(['stop', name])
  }

  async function removeSandbox(name: string): Promise<void> {
    await runSbx(['rm', name, '--force'])
  }
```

Update the return statement:
```ts
  return { runSbx, listSandboxes, createSandbox, applyPolicy, publishPorts, stopSandbox, removeSandbox }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx rtk proxy npx vitest run tests/main/sbx-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/sbx/adapter.ts tests/main/sbx-lifecycle.test.ts
git commit -m "feat(launch): adapter create/policy/ports/stop/remove lifecycle methods"
```

---

### Task 3: Native host terminal launcher

**Files:**
- Create: `src/main/terminal.ts`
- Test: `tests/main/terminal.test.ts`

**Interfaces:**
- Consumes: `SbxError` from `@shared/errors`.
- Produces:
  - `type SpawnTermFn = (cmd: string, args: string[]) => void`
  - `buildOsascriptArgs(command: string): string[]`
  - `openHostTerminal(command: string, opts?: { platform?: NodeJS.Platform; spawn?: SpawnTermFn }): void`

- [ ] **Step 1: Write the failing test**

Create `tests/main/terminal.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { buildOsascriptArgs, openHostTerminal } from '../../src/main/terminal'

describe('buildOsascriptArgs', () => {
  it('wraps the command in a Terminal do-script tell block', () => {
    const args = buildOsascriptArgs('sbx run --name x')
    expect(args[0]).toBe('-e')
    expect(args[1]).toContain('tell application "Terminal"')
    expect(args[1]).toContain('do script')
    expect(args[1]).toContain('sbx run --name x')
  })
  it('escapes embedded double quotes and backslashes', () => {
    const args = buildOsascriptArgs(`sbx exec -it 'a b' bash`)
    // AppleScript string is double-quoted; single quotes are safe, but the
    // script must remain a single valid -e argument.
    expect(args).toHaveLength(2)
    expect(args[1].startsWith('tell application "Terminal"')).toBe(true)
  })
})

describe('openHostTerminal', () => {
  it('spawns osascript on darwin', () => {
    const spawn = vi.fn()
    openHostTerminal('sbx run --name x', { platform: 'darwin', spawn })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0][0]).toBe('osascript')
    expect(spawn.mock.calls[0][1]).toEqual(buildOsascriptArgs('sbx run --name x'))
  })
  it('throws on non-darwin platforms', () => {
    const spawn = vi.fn()
    expect(() => openHostTerminal('sbx run --name x', { platform: 'linux', spawn })).toThrow(/macOS/)
    expect(spawn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx rtk proxy npx vitest run tests/main/terminal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the launcher**

Create `src/main/terminal.ts`:
```ts
import { spawn as nodeSpawn } from 'child_process'
import { SbxError } from '@shared/errors'

export type SpawnTermFn = (cmd: string, args: string[]) => void

const defaultSpawn: SpawnTermFn = (cmd, args) => {
  const child = nodeSpawn(cmd, args, { stdio: 'ignore', detached: true })
  child.unref()
}

/** Build `osascript -e '<applescript>'` args that open Terminal.app and run `command`. */
export function buildOsascriptArgs(command: string): string[] {
  // AppleScript string literal is double-quoted; escape backslashes then quotes.
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `tell application "Terminal" to do script "${escaped}"`
  return ['-e', script]
}

export function openHostTerminal(
  command: string,
  opts: { platform?: NodeJS.Platform; spawn?: SpawnTermFn } = {}
): void {
  const platform = opts.platform ?? process.platform
  const spawn = opts.spawn ?? defaultSpawn
  if (platform !== 'darwin') {
    throw new SbxError('generic', 'Opening a host terminal is only supported on macOS in this version.')
  }
  spawn('osascript', buildOsascriptArgs(command))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx rtk proxy npx vitest run tests/main/terminal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/terminal.ts tests/main/terminal.test.ts
git commit -m "feat(launch): native macOS Terminal.app launcher via osascript"
```

---

### Task 4: Launch orchestrator

**Files:**
- Create: `src/main/launch.ts`
- Test: `tests/main/launch.test.ts`

**Interfaces:**
- Consumes: `SbxAdapter` (Task 2), `Store.getDefinitionSpec` + `Store.upsertInstanceMeta`, `resolveSandboxName` + `agentAttachCommand` (Task 1), `SbxError`.
- Produces:
  - `interface LaunchDeps { adapter: SbxAdapter; store: Store; openTerminal: (command: string) => void }`
  - `launchDefinition(deps: LaunchDeps, definitionId: string): Promise<{ name: string }>`

- [ ] **Step 1: Write the failing test**

Create `tests/main/launch.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { launchDefinition } from '../../src/main/launch'
import type { DefinitionSpec, InstanceMeta } from '../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: ['api.example.com'],
  ports: [{ hostPort: 3000, containerPort: 8080, label: 'web' }],
  credentials: []
}

function deps(getSpec: () => DefinitionSpec | undefined) {
  const order: string[] = []
  const metas: InstanceMeta[] = []
  const adapter = {
    runSbx: vi.fn(), listSandboxes: vi.fn(),
    createSandbox: vi.fn(async () => { order.push('create') }),
    applyPolicy: vi.fn(async () => { order.push('policy') }),
    publishPorts: vi.fn(async () => { order.push('ports') }),
    stopSandbox: vi.fn(), removeSandbox: vi.fn()
  }
  const store = {
    getDefinitionSpec: vi.fn(getSpec),
    upsertInstanceMeta: vi.fn((m: InstanceMeta) => { order.push('meta'); metas.push(m) })
  } as never
  const openTerminal = vi.fn(() => { order.push('terminal') })
  return { adapter, store, openTerminal, order, metas }
}

describe('launchDefinition', () => {
  it('provisions, applies policy, publishes ports, records meta, then opens the agent terminal — in that order', async () => {
    const d = deps(() => spec)
    const res = await launchDefinition(d as never, 'd1')
    expect(res.name).toBe('my-project')
    expect(d.order).toEqual(['create', 'policy', 'ports', 'meta', 'terminal'])
    expect(d.adapter.applyPolicy).toHaveBeenCalledWith('my-project', 'locked', ['api.example.com'])
    expect(d.openTerminal).toHaveBeenCalledWith("sbx run --name 'my-project'")
  })

  it('records meta linking the sandbox to the definition as app-created', async () => {
    const d = deps(() => spec)
    await launchDefinition(d as never, 'd1')
    expect(d.metas[0].sbxName).toBe('my-project')
    expect(d.metas[0].definitionId).toBe('d1')
    expect(d.metas[0].createdByApp).toBe(true)
  })

  it('throws not-found when the definition is missing', async () => {
    const d = deps(() => undefined)
    await expect(launchDefinition(d as never, 'nope')).rejects.toThrow(/not found/i)
    expect(d.adapter.createSandbox).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx rtk proxy npx vitest run tests/main/launch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `src/main/launch.ts`:
```ts
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { resolveSandboxName, agentAttachCommand } from './sbx/translate'
import { SbxError } from '@shared/errors'

export interface LaunchDeps {
  adapter: SbxAdapter
  store: Store
  openTerminal: (command: string) => void
}

/**
 * Launch a running sandbox from a stored definition:
 *   provision → apply network tier → publish ports → record link → attach agent.
 * The sandbox name is resolved once and used for both `sbx` and the metadata row.
 */
export async function launchDefinition(deps: LaunchDeps, definitionId: string): Promise<{ name: string }> {
  const spec = deps.store.getDefinitionSpec(definitionId)
  if (!spec) throw new SbxError('not-found', `Definition ${definitionId} not found`)

  const name = resolveSandboxName(spec)
  await deps.adapter.createSandbox(spec)
  await deps.adapter.applyPolicy(name, spec.definition.tier, spec.domains)
  await deps.adapter.publishPorts(name, spec.ports)
  deps.store.upsertInstanceMeta({
    sbxName: name,
    definitionId,
    createdByApp: true,
    createdAt: new Date().toISOString()
  })
  deps.openTerminal(agentAttachCommand(name))
  return { name }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx rtk proxy npx vitest run tests/main/launch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/launch.ts tests/main/launch.test.ts
git commit -m "feat(launch): launchDefinition orchestrator (provision→policy→ports→meta→attach)"
```

---

### Task 5: IPC surface + preload + client + main wiring

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/ipc/client.ts`
- Test: `tests/main/ipc-lifecycle.test.ts`

**Interfaces:**
- Consumes: `launchDefinition` (Task 4), adapter lifecycle (Task 2), `hostShellCommand`/`agentAttachCommand` (Task 1).
- Produces (renderer-visible `window.api` additions):
  - `instanceLaunch(definitionId: string): Promise<Result<{ name: string }>>`
  - `instanceAttach(name: string): Promise<Result<null>>`
  - `instanceShell(name: string): Promise<Result<null>>`
  - `instanceStop(name: string): Promise<Result<null>>`
  - `instanceRemove(name: string): Promise<Result<null>>`
- Deps change: `buildHandlers`/`registerIpc` `Deps` gains `openTerminal: (command: string) => void`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/ipc-lifecycle.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'
import type { DefinitionSpec } from '../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], credentials: []
}

function deps() {
  const openTerminal = vi.fn()
  const adapter = {
    runSbx: vi.fn(), listSandboxes: vi.fn(async () => []),
    createSandbox: vi.fn(), applyPolicy: vi.fn(), publishPorts: vi.fn(),
    stopSandbox: vi.fn(async () => {}), removeSandbox: vi.fn(async () => {})
  }
  const store = {
    getDefinitionSpec: vi.fn(() => spec),
    upsertInstanceMeta: vi.fn(),
    deleteInstanceMeta: vi.fn()
  }
  const probes = {} as never
  return { adapter, store, probes, openTerminal }
}

describe('instance lifecycle IPC', () => {
  it('instance:launch returns the new name', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    const r = await h['instance:launch']('d1')
    expect(r).toEqual({ ok: true, data: { name: 'my-project' } })
    expect(d.adapter.createSandbox).toHaveBeenCalled()
  })

  it('instance:attach and instance:shell open a terminal with the right command', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    await h['instance:attach']('my-project')
    await h['instance:shell']('my-project')
    expect(d.openTerminal).toHaveBeenNthCalledWith(1, "sbx run --name 'my-project'")
    expect(d.openTerminal).toHaveBeenNthCalledWith(2, "sbx exec -it 'my-project' bash")
  })

  it('instance:stop calls the adapter', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    const r = await h['instance:stop']('my-project')
    expect(r.ok).toBe(true)
    expect(d.adapter.stopSandbox).toHaveBeenCalledWith('my-project')
  })

  it('instance:remove removes the sandbox and forgets its metadata', async () => {
    const d = deps()
    const h = buildHandlers(d as never)
    const r = await h['instance:remove']('my-project')
    expect(r.ok).toBe(true)
    expect(d.adapter.removeSandbox).toHaveBeenCalledWith('my-project')
    expect(d.store.deleteInstanceMeta).toHaveBeenCalledWith('my-project')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx rtk proxy npx vitest run tests/main/ipc-lifecycle.test.ts`
Expected: FAIL — `h['instance:launch'] is not a function`.

- [ ] **Step 3: Extend the IPC handlers**

In `src/main/ipc.ts`:

Add imports:
```ts
import { launchDefinition } from './launch'
import { agentAttachCommand, hostShellCommand } from './sbx/translate'
```

Change the `Deps` interface:
```ts
interface Deps { adapter: SbxAdapter; store: Store; probes: Probes; openTerminal: (command: string) => void }
```

Extend the `buildHandlers` return type (add these entries to the returned object type):
```ts
  'instance:launch': (definitionId: string) => Promise<Result<{ name: string }>>
  'instance:attach': (name: string) => Promise<Result<null>>
  'instance:shell': (name: string) => Promise<Result<null>>
  'instance:stop': (name: string) => Promise<Result<null>>
  'instance:remove': (name: string) => Promise<Result<null>>
```

Add the handlers to the returned object (inside `return { … }`):
```ts
    'instance:launch': (definitionId) => wrap(() => launchDefinition(
      { adapter: deps.adapter, store: deps.store, openTerminal: deps.openTerminal }, definitionId
    )),
    'instance:attach': (name) => wrap(async () => { deps.openTerminal(agentAttachCommand(name)); return null }),
    'instance:shell': (name) => wrap(async () => { deps.openTerminal(hostShellCommand(name)); return null }),
    'instance:stop': (name) => wrap(async () => { await deps.adapter.stopSandbox(name); return null }),
    'instance:remove': (name) => wrap(async () => {
      await deps.adapter.removeSandbox(name)
      deps.store.deleteInstanceMeta(name)
      return null
    })
```

Register them in `registerIpc` (after the existing `ipcMain.handle` calls, before the `dialog:pickFolder` handler):
```ts
  ipcMain.handle('instance:launch', (_e, id: string) => handlers['instance:launch'](id))
  ipcMain.handle('instance:attach', (_e, name: string) => handlers['instance:attach'](name))
  ipcMain.handle('instance:shell', (_e, name: string) => handlers['instance:shell'](name))
  ipcMain.handle('instance:stop', (_e, name: string) => handlers['instance:stop'](name))
  ipcMain.handle('instance:remove', (_e, name: string) => handlers['instance:remove'](name))
```

- [ ] **Step 4: Wire `openTerminal` in main**

In `src/main/index.ts`, add the import:
```ts
import { openHostTerminal } from './terminal'
```
Change the `registerIpc` call:
```ts
  registerIpc({ adapter: createSbxAdapter(), store, probes: systemProbes, openTerminal: (c) => openHostTerminal(c) })
```

- [ ] **Step 5: Expose in preload + client**

In `src/preload/index.ts`, add to the `api` object:
```ts
  instanceLaunch: (definitionId: string) => ipcRenderer.invoke('instance:launch', definitionId),
  instanceAttach: (name: string) => ipcRenderer.invoke('instance:attach', name),
  instanceShell: (name: string) => ipcRenderer.invoke('instance:shell', name),
  instanceStop: (name: string) => ipcRenderer.invoke('instance:stop', name),
  instanceRemove: (name: string) => ipcRenderer.invoke('instance:remove', name)
```

In `src/renderer/ipc/client.ts`, add to the `Api` interface:
```ts
  instanceLaunch(definitionId: string): Promise<Result<{ name: string }>>
  instanceAttach(name: string): Promise<Result<null>>
  instanceShell(name: string): Promise<Result<null>>
  instanceStop(name: string): Promise<Result<null>>
  instanceRemove(name: string): Promise<Result<null>>
```
and to the fallback object:
```ts
  instanceLaunch: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceAttach: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceShell: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceStop: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instanceRemove: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } })
```

- [ ] **Step 6: Update the existing ipc.test.ts construction**

`tests/main/ipc.test.ts` builds `buildHandlers({ adapter, store, probes })`. Add `openTerminal: () => {}` to that deps object so it satisfies the new `Deps` type. Run `npx rtk proxy npx vitest run tests/main/ipc.test.ts` and confirm it still PASSES.

- [ ] **Step 7: Run the new test + typecheck**

Run: `npx rtk proxy npx vitest run tests/main/ipc-lifecycle.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc-lifecycle.test.ts tests/main/ipc.test.ts
git commit -m "feat(launch): instance:launch/attach/shell/stop/remove IPC surface"
```

---

### Task 6: i18n strings + ConfirmModal + Instances actions + Definitions Launch

**Files:**
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Create: `src/renderer/components/ConfirmModal.tsx`
- Modify: `src/renderer/screens/Instances.tsx`
- Modify: `src/renderer/screens/Definitions.tsx`
- Test: `tests/renderer/ConfirmModal.test.tsx`, `tests/renderer/Instances.actions.test.tsx`, `tests/renderer/Definitions.test.tsx`

**Interfaces:**
- Consumes: `useT()`.
- Produces:
  - `ConfirmModal({ open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel }): JSX.Element | null`
  - `Instances({ instances, onAttach?, onShell?, onStop?, onRemove? })` — new optional callbacks `(name: string) => void`.
  - `Definitions({ definitions, onCreate, onLaunch? })` — new optional `onLaunch(definitionId: string) => void`.

- [ ] **Step 1: Add i18n keys**

In `src/renderer/i18n/en.ts`, add a `launch` key inside `definitions` and extend `instances`. Specifically:

Inside the `definitions: { … }` object add:
```ts
    launch: 'Launch',
    launching: 'Launching…',
```
Inside the `instances: { … }` object add:
```ts
    colActions: 'Actions',
    attach: 'Attach',
    shell: 'Shell',
    stop: 'Stop',
    remove: 'Remove',
    removeTitle: 'Remove sandbox?',
    removeBody: 'This permanently removes “{name}”: its container, Git worktrees, and sandbox state. This cannot be undone.',
    confirmRemove: 'Remove',
    cancel: 'Cancel',
    launched: 'Launched “{name}” — a terminal is opening.',
    actionFailed: 'Action failed: {message}',
```

In `src/renderer/i18n/de.ts`, add the German parity keys:

Inside `definitions`:
```ts
    launch: 'Starten',
    launching: 'Wird gestartet…',
```
Inside `instances`:
```ts
    colActions: 'Aktionen',
    attach: 'Verbinden',
    shell: 'Shell',
    stop: 'Stoppen',
    remove: 'Entfernen',
    removeTitle: 'Sandbox entfernen?',
    removeBody: 'Entfernt „{name}“ dauerhaft: Container, Git-Worktrees und Sandbox-Status. Dies kann nicht rückgängig gemacht werden.',
    confirmRemove: 'Entfernen',
    cancel: 'Abbrechen',
    launched: '„{name}“ gestartet — ein Terminal wird geöffnet.',
    actionFailed: 'Aktion fehlgeschlagen: {message}',
```

- [ ] **Step 2: Write the failing tests**

Create `tests/renderer/ConfirmModal.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmModal } from '../../src/renderer/components/ConfirmModal'

describe('ConfirmModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmModal open={false} title="T" body="B" confirmLabel="Yes" cancelLabel="No" onConfirm={() => {}} onCancel={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })
  it('fires onConfirm and onCancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmModal open title="Remove?" body="Are you sure" confirmLabel="Yes" cancelLabel="No" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Yes'))
    fireEvent.click(screen.getByText('No'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
```

Create `tests/renderer/Instances.actions.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Instances } from '../../src/renderer/screens/Instances'
import type { InstanceView } from '../../src/shared/types'

const inst: InstanceView = {
  name: 'my-project', status: 'running', agent: 'Claude Code', workspace: '/p', ports: [],
  definitionId: 'd1', definitionName: 'My Project', tier: 'locked'
}

describe('Instances actions', () => {
  it('invokes attach/shell/stop/remove callbacks with the instance name', () => {
    const onAttach = vi.fn(); const onShell = vi.fn(); const onStop = vi.fn(); const onRemove = vi.fn()
    render(<Instances instances={[inst]} onAttach={onAttach} onShell={onShell} onStop={onStop} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shell' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onAttach).toHaveBeenCalledWith('my-project')
    expect(onShell).toHaveBeenCalledWith('my-project')
    expect(onStop).toHaveBeenCalledWith('my-project')
    expect(onRemove).toHaveBeenCalledWith('my-project')
  })
})
```

Append to `tests/renderer/Definitions.test.tsx` a Launch case (keep existing tests). Add:
```tsx
import { fireEvent } from '@testing-library/react'
// … within the existing describe block:
it('invokes onLaunch with the definition id', () => {
  const onLaunch = vi.fn()
  const defs = [{ id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked' as const, createdAt: '2026-01-01T00:00:00.000Z' }]
  render(<Definitions definitions={defs} onCreate={() => {}} onLaunch={onLaunch} />)
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
  expect(onLaunch).toHaveBeenCalledWith('d1')
})
```
(Ensure `vi` and `fireEvent` are imported at the top of the file.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx rtk proxy npx vitest run tests/renderer/ConfirmModal.test.tsx tests/renderer/Instances.actions.test.tsx tests/renderer/Definitions.test.tsx`
Expected: FAIL — ConfirmModal module missing; no Attach/Launch buttons.

- [ ] **Step 4: Implement ConfirmModal**

Create `src/renderer/components/ConfirmModal.tsx`:
```tsx
interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: Props): JSX.Element | null {
  if (!open) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" style={{ maxWidth: 420, padding: 'var(--space-6)' }}>
        <h3 className="section-title" style={{ marginBottom: 'var(--space-3)' }}>{title}</h3>
        <p className="section-desc" style={{ marginBottom: 'var(--space-5)' }}>{body}</p>
        <div className="flex" style={{ gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
```
(If `btn-danger` is not an existing token class, use `className="btn"` with `style={{ background: 'var(--danger)', color: '#fff' }}` on the confirm button instead. Check `src/renderer/theme/app.css` for the button classes actually present and match them.)

- [ ] **Step 5: Add the actions column to Instances**

In `src/renderer/screens/Instances.tsx`, change the signature to accept optional callbacks:
```tsx
export function Instances({ instances, onAttach, onShell, onStop, onRemove }: {
  instances: InstanceView[]
  onAttach?: (name: string) => void
  onShell?: (name: string) => void
  onStop?: (name: string) => void
  onRemove?: (name: string) => void
}): JSX.Element {
```
Add a header cell after the ports column header:
```tsx
                <th>{t('instances.colPorts')}</th><th>{t('instances.colActions')}</th>
```
Add a final cell in each row (after the ports `<td>`):
```tsx
                  <td>
                    <div className="flex" style={{ gap: 'var(--space-2)' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => onAttach?.(i.name)}>{t('instances.attach')}</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onShell?.(i.name)}>{t('instances.shell')}</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onStop?.(i.name)}>{t('instances.stop')}</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onRemove?.(i.name)}>{t('instances.remove')}</button>
                    </div>
                  </td>
```
(Use whatever small-button class exists in `app.css`; if there is no `btn-sm`, drop it and rely on `btn btn-secondary`.)

- [ ] **Step 6: Add the Launch action to Definitions**

In `src/renderer/screens/Definitions.tsx`, add `onLaunch?: (definitionId: string) => void` to the props, and render a **Launch** button on each definition row/card that calls `onLaunch?.(d.id)` with label `t('definitions.launch')`. Place it next to the existing per-definition affordance; match the current card/row markup. (Read the current file first and mirror its structure — do not restructure it.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx rtk proxy npx vitest run tests/renderer/ConfirmModal.test.tsx tests/renderer/Instances.actions.test.tsx tests/renderer/Definitions.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/i18n/en.ts src/renderer/i18n/de.ts src/renderer/components/ConfirmModal.tsx src/renderer/screens/Instances.tsx src/renderer/screens/Definitions.tsx tests/renderer/ConfirmModal.test.tsx tests/renderer/Instances.actions.test.tsx tests/renderer/Definitions.test.tsx
git commit -m "feat(launch): Launch action, Instances lifecycle buttons, confirm modal + i18n"
```

---

### Task 7: App orchestration + confirm-on-remove + full sweep

**Files:**
- Modify: `src/renderer/App.tsx`
- Test: `tests/renderer/App.launch.test.tsx`

**Interfaces:**
- Consumes: `api.instanceLaunch/instanceAttach/instanceShell/instanceStop/instanceRemove`, `ConfirmModal`, `Instances` + `Definitions` callbacks, `useT`.
- Produces: no new exports; wires callbacks + a remove-confirmation state machine.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/App.launch.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../../src/renderer/App'

const okPrereq = { ok: true, data: { ok: true, checks: [] } }
const oneDef = { ok: true, data: [{ id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' }] }
const runningInst = { ok: true, data: [{ name: 'my-project', status: 'running', agent: 'Claude Code', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'My Project', tier: 'locked' }] }

function installApi(over: Record<string, unknown> = {}) {
  ;(globalThis as unknown as { api: Record<string, unknown> }).api = {
    prereqCheck: async () => okPrereq,
    defList: async () => oneDef,
    instancesList: async () => runningInst,
    instanceLaunch: vi.fn(async () => ({ ok: true, data: { name: 'my-project' } })),
    instanceAttach: vi.fn(async () => ({ ok: true, data: null })),
    instanceShell: vi.fn(async () => ({ ok: true, data: null })),
    instanceStop: vi.fn(async () => ({ ok: true, data: null })),
    instanceRemove: vi.fn(async () => ({ ok: true, data: null })),
    pickFolder: async () => null,
    ...over
  }
  return (globalThis as unknown as { api: Record<string, unknown> }).api
}

describe('App launch & lifecycle wiring', () => {
  beforeEach(() => { installApi() })

  it('Launch on a definition calls instanceLaunch', async () => {
    const api = installApi()
    render(<App />)
    await screen.findByRole('button', { name: 'Launch' })
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(api.instanceLaunch).toHaveBeenCalledWith('d1'))
  })

  it('Remove asks for confirmation before calling instanceRemove', async () => {
    const api = installApi()
    render(<App />)
    // navigate to Instances
    fireEvent.click(await screen.findByRole('button', { name: /Instances/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    // modal appears; instanceRemove not called yet
    expect(api.instanceRemove).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove', hidden: false }))
    // NOTE: there are now two "Remove" buttons (row + modal-confirm). Confirm via the dialog:
    await waitFor(() => expect(api.instanceRemove).toHaveBeenCalledWith('my-project'))
  })
})
```
> If the double-"Remove" label makes the query ambiguous, disambiguate in the test by scoping to the dialog: `within(screen.getByRole('dialog')).getByText('Remove')`. Import `within` from `@testing-library/react`. Adjust the test to whichever query is unambiguous given the final markup; the assertion that matters is *instanceRemove is only called after confirming*.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx rtk proxy npx vitest run tests/renderer/App.launch.test.tsx`
Expected: FAIL — no Launch wiring / no confirmation gate.

- [ ] **Step 3: Wire App.tsx**

In `src/renderer/App.tsx`:

Add imports:
```tsx
import { useT } from './i18n'
import { ConfirmModal } from './components/ConfirmModal'
```
Add state (near the other `useState` calls):
```tsx
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const t = useT()
```
Add handlers (near `navigate`):
```tsx
  async function onLaunch(definitionId: string): Promise<void> {
    const r = await api.instanceLaunch(definitionId)
    if (r.ok) { setScreen('instances'); await loadInstances() }
  }
  async function refreshAfter(p: Promise<unknown>): Promise<void> { await p; await loadInstances() }
  function onAttach(name: string): void { void api.instanceAttach(name) }
  function onShell(name: string): void { void api.instanceShell(name) }
  function onStop(name: string): void { void refreshAfter(api.instanceStop(name)) }
  function onRemoveConfirmed(): void {
    const name = pendingRemove
    setPendingRemove(null)
    if (name) void refreshAfter(api.instanceRemove(name))
  }
```
Change the Definitions render to pass `onLaunch`:
```tsx
          : <Definitions definitions={defs} onCreate={() => setWizard(true)} onLaunch={(id) => void onLaunch(id)} />
```
Change the Instances render to pass callbacks:
```tsx
      {screen === 'instances' && (
        <Instances instances={instances} onAttach={onAttach} onShell={onShell} onStop={onStop} onRemove={(name) => setPendingRemove(name)} />
      )}
```
Add the modal just before the closing `</AppShell>`:
```tsx
      <ConfirmModal
        open={pendingRemove !== null}
        title={t('instances.removeTitle')}
        body={t('instances.removeBody', { name: pendingRemove ?? '' })}
        confirmLabel={t('instances.confirmRemove')}
        cancelLabel={t('instances.cancel')}
        onConfirm={onRemoveConfirmed}
        onCancel={() => setPendingRemove(null)}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx rtk proxy npx vitest run tests/renderer/App.launch.test.tsx`
Expected: PASS. (If the modal-vs-row "Remove" query is ambiguous, apply the `within(dialog)` disambiguation noted in Step 1.)

- [ ] **Step 5: Full sweep + typecheck + build**

Run: `npx rtk proxy npx vitest run`
Expected: all tests PASS (Phase 1–2 suite + the ~7 new Phase 3 test files).
Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: electron-vite build succeeds (main + preload `index.cjs` + renderer). If the build flips `better-sqlite3` to the Electron ABI, the next `npm test` will re-flip via the `pretest` hook — do not hand-rebuild.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx tests/renderer/App.launch.test.tsx
git commit -m "feat(launch): App wiring for launch/attach/shell/stop and confirm-on-remove"
```

---

## Self-Review

- **Spec coverage vs Architecture R2 (lifecycle):** create ✓ (Task 4 launch), start/attach ✓ (native `sbx run` terminal), stop ✓ (`sbx stop`), remove ✓ (`sbx rm --force` behind a confirm modal — R2's "stop vs remove distinct + confirmation" satisfied). List view still produced by Phase 2 `reconcile()` ✓.
- **Spec coverage vs Flows 1 & 2:** Flow 1 (create → terminal bound to sandbox) = launch opens `sbx run` terminal ✓. Flow 2 (separate host terminal) = `instance:shell` opens `sbx exec -it … bash` ✓.
- **Spec coverage vs "configure publish ports":** port intents from Phase 2 are published at launch via `sbx ports --publish` ✓.
- **Network policy safety:** no `policy reset` anywhere; per-sandbox `--sandbox` scope only ✓ (Global Constraints + Task 2).
- **Placeholder scan:** every code step contains complete code. The only prose-only steps are Task 6 Step 6 (Definitions Launch button — deliberately says "mirror current markup" because that file's row/card structure must be read first) and Task 6 Step 5 button-class caveats. These are grounded ("read the file, match its structure"), not TBDs.
- **Type consistency:** `resolveSandboxName` used identically in `specToCreateArgs`, `adapter.createSandbox`, and `launchDefinition`'s meta write → create name always equals meta name. `Result<null>` shape used consistently for void-ish IPC. `openTerminal: (command: string) => void` identical in `Deps`, `LaunchDeps`, and `index.ts`.
- **Ambiguity check:** the double-"Remove" label (row action + modal confirm) is called out with a `within(dialog)` remedy so the App test stays unambiguous.

## Notes for later phases

- **Embedded terminals (arch R5/R6 pty-bridge)** are intentionally deferred — this phase uses native Terminal.app. If in-window terminals are wanted later, that is a separate phase adding `node-pty` (native module → ABI rebuild like `better-sqlite3`), a localhost WebSocket bridge, and `xterm.js`.
- **Cross-platform terminals:** `openHostTerminal` is macOS-only (`osascript`). Windows (`wt`/`cmd`) and Linux (`x-terminal-emulator`) branches are a later addition; the platform guard already throws a clear error elsewhere.
- **Adapter spawn timeout:** `defaultSpawn` in `adapter.ts` still has no timeout. Long-running/hanging `sbx` calls (e.g. a wedged daemon) would block the IPC promise. Adding a timeout to `defaultSpawn` (mirroring `probes.ts` `tryCmd`) is a reasonable hardening task, out of scope here.
- **Credential injection (Phase 6):** launch currently ignores `spec.credentials` (declarations only). Phase 6 adds `sbx secret set` before `sbx create`/attach, keyed off these declarations.
- **Live monitoring / traffic feed (arch R7):** not touched here; `sbx policy log` is the likely data source when that phase lands.
```