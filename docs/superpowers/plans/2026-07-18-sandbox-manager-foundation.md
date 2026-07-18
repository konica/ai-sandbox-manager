# AI Sandbox Manager — Phase 1: Foundation & Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable Electron desktop app that gates on `sbx` prerequisites and lists the real Docker Sandboxes on the machine as "Instances," reconciled against a local SQLite metadata store.

**Architecture:** Electron two-process app (Node main + Chromium/React renderer) built with `electron-vite`. The main process owns all `sbx` access through a single `#sbx-adapter` choke point, a `#prereq-detector`, a `better-sqlite3` `#metadata-store`, and a `#reconciler` that joins `sbx ls` output with stored metadata. The renderer (React + TS) talks to main only through a typed, allowlisted `preload` IPC bridge and renders two screens: Prereq and Instances. `sbx` is the source of truth for instance existence/status; the DB only holds app metadata.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript (strict), better-sqlite3, Vitest, @testing-library/react, electron-builder (config only; packaging is Phase 7).

## Global Constraints

- **Single-user, single-machine** desktop app; no server, no auth layer.
- **`sbx` CLI only** — the app shells out via `child_process`; there is no `sbx` SDK. Only `#sbx-adapter` (`electron/sbx/adapter.ts`) may spawn `sbx`; nothing else in the codebase spawns it.
- **`sbx` is the source of truth** for instance existence and status; the local DB is derived/supplementary and is always reconciled, never trusted alone for state.
- **No secret values in SQLite or the sandbox filesystem, ever** (no value-accepting DB column exists). (Credentials arrive in Phase 3/6; the schema here must already forbid value columns.)
- **TypeScript strict mode** across main, preload, and renderer. Shared types live in `src/shared/` and are imported by both processes.
- **contextIsolation on, nodeIntegration off**; the renderer has no `child_process`/Node access — it reaches main only through the `preload` allowlist.
- **IPC results are shaped** `{ ok: true; data: T } | { ok: false; error: { kind: string; message: string } }` — never throw across the IPC boundary.
- **Agent is fixed to "Claude Code"** at MVP.
- **Design tokens** come from the mockup export `brainstorm/mockup/AI Sandbox Manager v3` (dark theme; `--accent: #4f8cff`; mono font JetBrains Mono). Freeze tokens into `src/renderer/theme/tokens.css` before building components.
- **Commit after every task.** Use `git init` in Task 1 (the repo is not yet under version control).

---

## File Structure (Phase 1)

```
package.json                         electron-vite + electron-builder scripts, deps
electron.vite.config.ts              electron-vite config (main/preload/renderer)
tsconfig.json                        strict TS, path aliases
vitest.config.ts                     unit test runner
index.html                           renderer entry
src/
  shared/
    types.ts                         shared types (SbxInstance, Definition, InstanceView, Prereq*, Result<T>)
    errors.ts                        SbxError class + kind classifier
  main/
    index.ts                         app bootstrap, BrowserWindow, wires IPC
    sbx/
      parse.ts                       pure parsers: sbx ls (JSON + text), error classification
      adapter.ts                     #sbx-adapter — the ONLY sbx spawn site
    store/
      db.ts                          #metadata-store — better-sqlite3 schema + typed queries
    reconciler.ts                    #reconciler — join sbx ls ⟕ instance_meta ⟕ definition
    prereq.ts                        #prereq-detector — environment checks
    ipc.ts                           registers ipcMain handlers (prereq:check, instances:list)
  preload/
    index.ts                         contextBridge allowlist → window.api
  renderer/
    main.tsx                         React root
    App.tsx                          prereq gate → screen router
    theme/tokens.css                 frozen design tokens
    ipc/client.ts                    typed wrapper over window.api
    screens/
      Prereq.tsx                     prerequisite screen
      Instances.tsx                  instances list screen
tests/
  shared/errors.test.ts
  main/sbx/parse.test.ts
  main/store/db.test.ts
  main/reconciler.test.ts
  main/prereq.test.ts
  main/ipc.test.ts
  renderer/Prereq.test.tsx
  renderer/Instances.test.tsx
```

---

### Task 1: Project scaffold, tooling, and test harness

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `index.html`, `.gitignore`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`
- Create: `src/shared/version.ts`, `tests/shared/version.test.ts` (harness smoke test)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a runnable app (`npm run dev`), a passing test runner (`npm test`), and the module/alias layout every later task builds on. Path alias `@shared/*` → `src/shared/*`, `@main/*` → `src/main/*`.

- [ ] **Step 1: Initialize the repo and package manifest**

```bash
cd /Users/ttdinh/Documents/Working/Projects/AISandbox/aisandbox
git init
```

Create `package.json`:

```json
{
  "name": "ai-sandbox-manager",
  "version": "0.1.0",
  "description": "Local control-plane GUI for Docker Sandboxes running Claude Code",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "rebuild": "electron-rebuild -f -w better-sqlite3"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.7.1",
    "@testing-library/react": "^16.1.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@types/better-sqlite3": "^7.6.12",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "electron": "^33.2.1",
    "electron-vite": "^2.3.0",
    "electron-builder": "^25.1.8",
    "jsdom": "^25.0.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.7.2",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Add tsconfig, vite, vitest, gitignore configs**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@main/*": ["src/main/*"]
    }
  },
  "include": ["src", "tests"]
}
```

Create `electron.vite.config.ts`:

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared'), '@main': resolve('src/main') } }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  }
})
```

Create `vitest.config.ts`:

```ts
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@main': resolve('src/main') } },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
    globals: true,
    setupFiles: ['tests/setup.ts']
  }
})
```

Create `tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

Create `.gitignore`:

```
node_modules/
out/
dist/
*.log
.DS_Store
```

- [ ] **Step 3: Write the harness smoke test (failing)**

Create `tests/shared/version.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { APP_NAME, FIXED_AGENT } from '@shared/version'

describe('app constants', () => {
  it('exposes the product name and the fixed MVP agent', () => {
    expect(APP_NAME).toBe('AI Sandbox Manager')
    expect(FIXED_AGENT).toBe('Claude Code')
  })
})
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npm install && npm test -- tests/shared/version.test.ts`
Expected: FAIL — cannot resolve `@shared/version`.

- [ ] **Step 5: Create the shared constants and app entry points**

Create `src/shared/version.ts`:

```ts
export const APP_NAME = 'AI Sandbox Manager'
export const FIXED_AGENT = 'Claude Code'
```

Create `index.html`:

```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>AI Sandbox Manager</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

Create `src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

Create `src/preload/index.ts`:

```ts
import { contextBridge } from 'electron'

// Real IPC methods are added in Task 7. This stub establishes the bridge.
contextBridge.exposeInMainWorld('api', {})
```

Create `src/renderer/main.tsx`:

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

Create `src/renderer/App.tsx`:

```tsx
import { APP_NAME } from '@shared/version'

export default function App(): JSX.Element {
  return <h1>{APP_NAME}</h1>
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/shared/version.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify the app launches**

Run: `npm run dev`
Expected: an Electron window opens showing the heading "AI Sandbox Manager". Close it.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite + react + ts app with vitest harness"
```

---

### Task 2: `sbx` output parsers (`parse.ts`)

**Files:**
- Create: `src/shared/types.ts`, `src/shared/errors.ts`
- Create: `src/main/sbx/parse.ts`
- Test: `tests/shared/errors.test.ts`, `tests/main/sbx/parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SbxStatus = 'running' | 'stopped' | 'error' | 'unknown'`
  - `interface SbxInstance { name: string; status: SbxStatus; agent: string; workspace: string | null; ports: string[] }`
  - `type SbxErrorKind = 'not-installed' | 'not-authed' | 'not-found' | 'policy-rejected' | 'generic'`
  - `class SbxError extends Error { readonly kind: SbxErrorKind }`
  - `classifySbxError(code: number, stderr: string): SbxErrorKind`
  - `parseSbxLsJson(stdout: string): SbxInstance[]` (throws on non-JSON)
  - `parseSbxLsText(stdout: string): SbxInstance[]`

- [ ] **Step 1: Write failing tests for shared types + error classifier**

Create `tests/shared/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SbxError, classifySbxError } from '@shared/errors'

describe('classifySbxError', () => {
  it('detects a missing binary', () => {
    expect(classifySbxError(127, 'sbx: command not found')).toBe('not-installed')
  })
  it('detects an unauthenticated session', () => {
    expect(classifySbxError(1, 'Error: not logged in. Run `sbx login`.')).toBe('not-authed')
  })
  it('detects a missing sandbox', () => {
    expect(classifySbxError(1, 'sandbox "foo" not found')).toBe('not-found')
  })
  it('falls back to generic', () => {
    expect(classifySbxError(2, 'some other failure')).toBe('generic')
  })
})

describe('SbxError', () => {
  it('carries a kind', () => {
    const e = new SbxError('not-authed', 'please log in')
    expect(e.kind).toBe('not-authed')
    expect(e.message).toBe('please log in')
    expect(e).toBeInstanceOf(Error)
  })
})
```

- [ ] **Step 2: Write failing tests for the `sbx ls` parsers**

Create `tests/main/sbx/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSbxLsJson, parseSbxLsText } from '@main/sbx/parse'

describe('parseSbxLsText', () => {
  it('parses the documented table layout', () => {
    const out = [
      'SANDBOX             AGENT   STATUS    PORTS                       WORKSPACE',
      'my-sandbox          claude  running   127.0.0.1:8080->3000/tcp    /home/user/proj',
      'idle-box            claude  stopped   -                           /home/user/other'
    ].join('\n')
    const rows = parseSbxLsText(out)
    expect(rows).toEqual([
      { name: 'my-sandbox', status: 'running', agent: 'claude', ports: ['127.0.0.1:8080->3000/tcp'], workspace: '/home/user/proj' },
      { name: 'idle-box', status: 'stopped', agent: 'claude', ports: [], workspace: '/home/user/other' }
    ])
  })
  it('returns [] for a header-only / empty listing', () => {
    expect(parseSbxLsText('SANDBOX AGENT STATUS PORTS WORKSPACE\n')).toEqual([])
    expect(parseSbxLsText('')).toEqual([])
  })
  it('maps unknown status strings to "unknown"', () => {
    const out = 'SANDBOX  AGENT   STATUS   PORTS  WORKSPACE\nx  claude  paused   -  /w'
    expect(parseSbxLsText(out)[0].status).toBe('unknown')
  })
})

describe('parseSbxLsJson', () => {
  it('maps JSON objects to SbxInstance', () => {
    const json = JSON.stringify([
      { name: 'my-sandbox', agent: 'claude', status: 'running', ports: ['127.0.0.1:8080->3000/tcp'], workspace: '/home/user/proj' }
    ])
    expect(parseSbxLsJson(json)).toEqual([
      { name: 'my-sandbox', status: 'running', agent: 'claude', ports: ['127.0.0.1:8080->3000/tcp'], workspace: '/home/user/proj' }
    ])
  })
  it('throws on non-JSON so the caller can fall back to text', () => {
    expect(() => parseSbxLsJson('SANDBOX AGENT ...')).toThrow()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/shared/errors.test.ts tests/main/sbx/parse.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement shared types + errors**

Create `src/shared/types.ts`:

```ts
export type SbxStatus = 'running' | 'stopped' | 'error' | 'unknown'

export interface SbxInstance {
  name: string
  status: SbxStatus
  agent: string
  workspace: string | null
  ports: string[]
}

export type Tier = 'open' | 'balanced' | 'locked'

export interface Definition {
  id: string
  name: string
  description: string
  baseImage: string
  tier: Tier
  createdAt: string
}

export interface InstanceMeta {
  sbxName: string
  definitionId: string | null
  createdByApp: boolean
  createdAt: string
}

export interface InstanceView extends SbxInstance {
  definitionId: string | null
  definitionName: string | null
  tier: Tier | 'custom'
}

export interface PrereqCheck {
  id: 'docker' | 'sbx' | 'auth' | 'disk' | 'keychain'
  label: string
  ok: boolean
  detail: string
  remediation?: string
}

export interface PrereqResult {
  ok: boolean
  checks: PrereqCheck[]
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { kind: string; message: string } }
```

Create `src/shared/errors.ts`:

```ts
import type { SbxErrorKind } from './types-errors'

export type { SbxErrorKind }

export class SbxError extends Error {
  readonly kind: SbxErrorKind
  constructor(kind: SbxErrorKind, message: string) {
    super(message)
    this.name = 'SbxError'
    this.kind = kind
  }
}

export function classifySbxError(code: number, stderr: string): SbxErrorKind {
  const s = stderr.toLowerCase()
  if (code === 127 || s.includes('command not found') || s.includes('enoent')) return 'not-installed'
  if (s.includes('not logged in') || s.includes('sbx login') || s.includes('unauthenticated')) return 'not-authed'
  if (s.includes('not found')) return 'not-found'
  if (s.includes('policy') && (s.includes('denied') || s.includes('rejected'))) return 'policy-rejected'
  return 'generic'
}
```

Create `src/shared/types-errors.ts`:

```ts
export type SbxErrorKind = 'not-installed' | 'not-authed' | 'not-found' | 'policy-rejected' | 'generic'
```

- [ ] **Step 5: Implement the parsers**

Create `src/main/sbx/parse.ts`:

```ts
import type { SbxInstance, SbxStatus } from '@shared/types'

function toStatus(raw: string): SbxStatus {
  const s = raw.toLowerCase()
  if (s === 'running' || s === 'stopped' || s === 'error') return s
  return 'unknown'
}

function splitPorts(raw: string): string[] {
  const v = raw.trim()
  if (v === '' || v === '-' || v === '—') return []
  return v.split(',').map((p) => p.trim()).filter(Boolean)
}

/** Parse `sbx ls --json` output. Throws if not valid JSON. */
export function parseSbxLsJson(stdout: string): SbxInstance[] {
  const data = JSON.parse(stdout) as Array<Record<string, unknown>>
  return data.map((r) => ({
    name: String(r.name ?? ''),
    status: toStatus(String(r.status ?? '')),
    agent: String(r.agent ?? ''),
    workspace: r.workspace ? String(r.workspace) : null,
    ports: Array.isArray(r.ports) ? (r.ports as unknown[]).map(String) : splitPorts(String(r.ports ?? ''))
  }))
}

/** Parse the whitespace-aligned `sbx ls` table (columns separated by runs of 2+ spaces). */
export function parseSbxLsText(stdout: string): SbxInstance[] {
  const lines = stdout.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  const header = lines[0].toUpperCase()
  const dataLines = header.startsWith('SANDBOX') ? lines.slice(1) : lines
  return dataLines.map((line) => {
    const cols = line.split(/\s{2,}/).map((c) => c.trim())
    const [name = '', agent = '', status = '', ports = '', workspace = ''] = cols
    return {
      name,
      agent,
      status: toStatus(status),
      ports: splitPorts(ports),
      workspace: workspace === '' || workspace === '-' ? null : workspace
    }
  })
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/shared/errors.test.ts tests/main/sbx/parse.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sbx): add sbx ls parsers and SbxError classification"
```

---

### Task 3: `#sbx-adapter` — the single `sbx` spawn site

**Files:**
- Create: `src/main/sbx/adapter.ts`
- Test: `tests/main/sbx/adapter.test.ts`

**Interfaces:**
- Consumes: `parseSbxLsJson`, `parseSbxLsText`, `SbxError`, `classifySbxError` (Task 2).
- Produces:
  - `interface SbxResult { stdout: string; stderr: string; code: number }`
  - `interface SbxAdapter { runSbx(args: string[], opts?: { stdin?: string }): Promise<SbxResult>; listSandboxes(): Promise<SbxInstance[]> }`
  - `function createSbxAdapter(spawnFn?: SpawnFn): SbxAdapter` where `type SpawnFn = (cmd: string, args: string[], opts: { stdin?: string }) => Promise<SbxResult>`. The injectable `spawnFn` exists so tests never touch a real process; production defaults to a `child_process.spawn` wrapper.

- [ ] **Step 1: Write the failing tests (with a fake spawn)**

Create `tests/main/sbx/adapter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSbxAdapter } from '@main/sbx/adapter'
import { SbxError } from '@shared/errors'

const ok = (stdout: string) => vi.fn().mockResolvedValue({ stdout, stderr: '', code: 0 })

describe('createSbxAdapter.listSandboxes', () => {
  it('prefers --json and parses it', async () => {
    const json = JSON.stringify([{ name: 'a', agent: 'claude', status: 'running', ports: [], workspace: '/w' }])
    const spawn = ok(json)
    const adapter = createSbxAdapter(spawn)
    const rows = await adapter.listSandboxes()
    expect(spawn).toHaveBeenCalledWith('sbx', ['ls', '--json'], expect.anything())
    expect(rows[0].name).toBe('a')
  })

  it('falls back to text parsing when --json is not valid JSON', async () => {
    const text = 'SANDBOX  AGENT   STATUS   PORTS  WORKSPACE\na  claude  running  -  /w'
    const spawn = vi.fn().mockResolvedValue({ stdout: text, stderr: '', code: 0 })
    const adapter = createSbxAdapter(spawn)
    const rows = await adapter.listSandboxes()
    expect(rows[0]).toMatchObject({ name: 'a', status: 'running', workspace: '/w' })
  })
})

describe('createSbxAdapter.runSbx', () => {
  it('throws a classified SbxError on non-zero exit', async () => {
    const spawn = vi.fn().mockResolvedValue({ stdout: '', stderr: 'not logged in. Run `sbx login`.', code: 1 })
    const adapter = createSbxAdapter(spawn)
    await expect(adapter.runSbx(['ls'])).rejects.toMatchObject({ kind: 'not-authed' })
    await expect(adapter.runSbx(['ls'])).rejects.toBeInstanceOf(SbxError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/main/sbx/adapter.test.ts`
Expected: FAIL — `@main/sbx/adapter` not found.

- [ ] **Step 3: Implement the adapter**

Create `src/main/sbx/adapter.ts`:

```ts
import { spawn } from 'child_process'
import type { SbxInstance } from '@shared/types'
import { SbxError, classifySbxError } from '@shared/errors'
import { parseSbxLsJson, parseSbxLsText } from './parse'

export interface SbxResult { stdout: string; stderr: string; code: number }

export type SpawnFn = (cmd: string, args: string[], opts: { stdin?: string }) => Promise<SbxResult>

export interface SbxAdapter {
  runSbx(args: string[], opts?: { stdin?: string }): Promise<SbxResult>
  listSandboxes(): Promise<SbxInstance[]>
}

const defaultSpawn: SpawnFn = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => reject(new SbxError('not-installed', err.message)))
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin)
      child.stdin.end()
    }
  })

export function createSbxAdapter(spawnFn: SpawnFn = defaultSpawn): SbxAdapter {
  async function runSbx(args: string[], opts: { stdin?: string } = {}): Promise<SbxResult> {
    const res = await spawnFn('sbx', args, opts)
    if (res.code !== 0) throw new SbxError(classifySbxError(res.code, res.stderr), res.stderr.trim() || `sbx exited ${res.code}`)
    return res
  }

  async function listSandboxes(): Promise<SbxInstance[]> {
    const res = await runSbx(['ls', '--json'])
    try {
      return parseSbxLsJson(res.stdout)
    } catch {
      return parseSbxLsText(res.stdout)
    }
  }

  return { runSbx, listSandboxes }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/main/sbx/adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sbx): add #sbx-adapter choke point with injectable spawn"
```

---

### Task 4: `#metadata-store` — SQLite schema & typed queries

**Files:**
- Create: `src/main/store/db.ts`
- Test: `tests/main/store/db.test.ts`

**Interfaces:**
- Consumes: `Definition`, `InstanceMeta`, `Tier` (Task 2).
- Produces:
  - `interface Store { insertDefinition(d: Definition): void; listDefinitions(): Definition[]; getDefinition(id: string): Definition | null; upsertInstanceMeta(m: InstanceMeta): void; listInstanceMeta(): InstanceMeta[]; deleteInstanceMeta(sbxName: string): void; close(): void }`
  - `function openStore(filename: string): Store` (pass `':memory:'` in tests).
- Invariant: **no table has a secret-value column.**

- [ ] **Step 1: Write the failing test**

Create `tests/main/store/db.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '@main/store/db'

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('metadata-store', () => {
  it('round-trips a definition', () => {
    store.insertDefinition({ id: 'def1', name: 'prj-alpha', description: 'alpha', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
    expect(store.listDefinitions()).toHaveLength(1)
    expect(store.getDefinition('def1')?.name).toBe('prj-alpha')
    expect(store.getDefinition('nope')).toBeNull()
  })

  it('upserts instance metadata by sbx name', () => {
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: 'def1', createdByApp: true, createdAt: '2026-07-18T00:00:00Z' })
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: 'def1', createdByApp: true, createdAt: '2026-07-18T01:00:00Z' })
    const rows = store.listInstanceMeta()
    expect(rows).toHaveLength(1)
    expect(rows[0].createdAt).toBe('2026-07-18T01:00:00Z')
  })

  it('deletes orphaned instance metadata', () => {
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: null, createdByApp: false, createdAt: '2026-07-18T00:00:00Z' })
    store.deleteInstanceMeta('sbx-a')
    expect(store.listInstanceMeta()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/main/store/db.test.ts`
Expected: FAIL — `@main/store/db` not found.

- [ ] **Step 3: Implement the store**

Create `src/main/store/db.ts`:

```ts
import Database from 'better-sqlite3'
import type { Definition, InstanceMeta, Tier } from '@shared/types'

export interface Store {
  insertDefinition(d: Definition): void
  listDefinitions(): Definition[]
  getDefinition(id: string): Definition | null
  upsertInstanceMeta(m: InstanceMeta): void
  listInstanceMeta(): InstanceMeta[]
  deleteInstanceMeta(sbxName: string): void
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS definition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_image TEXT NOT NULL,
  tier TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS instance_meta (
  sbx_name TEXT PRIMARY KEY,
  definition_id TEXT,
  created_by_app INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS app_prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
`

export function openStore(filename: string): Store {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)

  return {
    insertDefinition(d) {
      db.prepare(
        `INSERT INTO definition (id, name, description, base_image, tier, created_at)
         VALUES (@id, @name, @description, @baseImage, @tier, @createdAt)`
      ).run(d)
    },
    listDefinitions() {
      return db.prepare(`SELECT id, name, description, base_image AS baseImage, tier, created_at AS createdAt FROM definition ORDER BY created_at DESC`).all() as Definition[]
    },
    getDefinition(id) {
      const row = db.prepare(`SELECT id, name, description, base_image AS baseImage, tier, created_at AS createdAt FROM definition WHERE id = ?`).get(id)
      return (row as Definition) ?? null
    },
    upsertInstanceMeta(m) {
      db.prepare(
        `INSERT INTO instance_meta (sbx_name, definition_id, created_by_app, created_at)
         VALUES (@sbxName, @definitionId, @createdByApp, @createdAt)
         ON CONFLICT(sbx_name) DO UPDATE SET
           definition_id = excluded.definition_id,
           created_by_app = excluded.created_by_app,
           created_at = excluded.created_at`
      ).run({ ...m, createdByApp: m.createdByApp ? 1 : 0 })
    },
    listInstanceMeta() {
      const rows = db.prepare(`SELECT sbx_name AS sbxName, definition_id AS definitionId, created_by_app AS createdByApp, created_at AS createdAt FROM instance_meta`).all() as Array<Record<string, unknown>>
      return rows.map((r) => ({ sbxName: String(r.sbxName), definitionId: r.definitionId ? String(r.definitionId) : null, createdByApp: r.createdByApp === 1, createdAt: String(r.createdAt) }))
    },
    deleteInstanceMeta(sbxName) {
      db.prepare(`DELETE FROM instance_meta WHERE sbx_name = ?`).run(sbxName)
    },
    close() { db.close() }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/main/store/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(store): add better-sqlite3 metadata store (definitions + instance meta)"
```

---

### Task 5: `#reconciler` — join `sbx` state with local metadata

**Files:**
- Create: `src/main/reconciler.ts`
- Test: `tests/main/reconciler.test.ts`

**Interfaces:**
- Consumes: `SbxAdapter` (Task 3), `Store` (Task 4), `InstanceView`, `Tier` (Task 2).
- Produces:
  - `function reconcile(adapter: SbxAdapter, store: Store): Promise<InstanceView[]>` — for each `sbx ls` row, left-join `instance_meta` + `definition`; sets `definitionName`/`definitionId` (null if external) and `tier` (definition's tier, or `'custom'` if unknown). Also **garbage-collects orphaned metadata**: any `instance_meta` whose `sbxName` is absent from `sbx ls` is deleted. `sbx` always wins on existence/status.

- [ ] **Step 1: Write the failing test**

Create `tests/main/reconciler.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reconcile } from '@main/reconciler'
import { openStore } from '@main/store/db'
import type { SbxAdapter } from '@main/sbx/adapter'

function fakeAdapter(names: string[]): SbxAdapter {
  return {
    runSbx: async () => ({ stdout: '', stderr: '', code: 0 }),
    listSandboxes: async () => names.map((n) => ({ name: n, status: 'running', agent: 'claude', ports: [], workspace: '/w' }))
  }
}

describe('reconcile', () => {
  it('labels app-created instances with their definition tier', async () => {
    const store = openStore(':memory:')
    store.insertDefinition({ id: 'd1', name: 'prj-alpha', description: '', baseImage: 'img', tier: 'locked', createdAt: 't' })
    store.upsertInstanceMeta({ sbxName: 'sbx-a', definitionId: 'd1', createdByApp: true, createdAt: 't' })
    const views = await reconcile(fakeAdapter(['sbx-a']), store)
    expect(views[0]).toMatchObject({ name: 'sbx-a', definitionName: 'prj-alpha', tier: 'locked' })
  })

  it('shows externally-created instances with no definition and custom tier', async () => {
    const store = openStore(':memory:')
    const views = await reconcile(fakeAdapter(['ext-box']), store)
    expect(views[0]).toMatchObject({ name: 'ext-box', definitionId: null, definitionName: null, tier: 'custom' })
  })

  it('garbage-collects metadata for sandboxes sbx no longer reports', async () => {
    const store = openStore(':memory:')
    store.upsertInstanceMeta({ sbxName: 'gone', definitionId: null, createdByApp: true, createdAt: 't' })
    await reconcile(fakeAdapter([]), store)
    expect(store.listInstanceMeta()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/main/reconciler.test.ts`
Expected: FAIL — `@main/reconciler` not found.

- [ ] **Step 3: Implement the reconciler**

Create `src/main/reconciler.ts`:

```ts
import type { InstanceView } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'

export async function reconcile(adapter: SbxAdapter, store: Store): Promise<InstanceView[]> {
  const instances = await adapter.listSandboxes()
  const liveNames = new Set(instances.map((i) => i.name))
  const metaByName = new Map(store.listInstanceMeta().map((m) => [m.sbxName, m]))

  // GC: metadata whose sandbox no longer exists in sbx.
  for (const m of metaByName.values()) {
    if (!liveNames.has(m.sbxName)) store.deleteInstanceMeta(m.sbxName)
  }

  return instances.map((inst) => {
    const meta = metaByName.get(inst.name) ?? null
    const def = meta?.definitionId ? store.getDefinition(meta.definitionId) : null
    return {
      ...inst,
      definitionId: def?.id ?? null,
      definitionName: def?.name ?? null,
      tier: def?.tier ?? 'custom'
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/main/reconciler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(reconciler): join sbx ls with local metadata + GC orphans"
```

---

### Task 6: `#prereq-detector` — environment checks

**Files:**
- Create: `src/main/prereq.ts`
- Test: `tests/main/prereq.test.ts`

**Interfaces:**
- Consumes: `PrereqCheck`, `PrereqResult` (Task 2).
- Produces:
  - `interface Probes { hasDocker(): Promise<boolean>; sbxVersion(): Promise<string | null>; sbxAuthed(): Promise<boolean>; freeDiskBytes(): Promise<number>; keychainReachable(): Promise<boolean> }`
  - `function checkPrereqs(probes: Probes, minDiskBytes?: number): Promise<PrereqResult>` — builds the five checks (`docker`, `sbx`, `auth`, `disk`, `keychain`); `ok` is true only if `docker`, `sbx`, and `auth` all pass (disk/keychain are advisory and never block, but are reported). Default `minDiskBytes = 2 * 1024 ** 3` (2 GiB).

- [ ] **Step 1: Write the failing test**

Create `tests/main/prereq.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkPrereqs, type Probes } from '@main/prereq'

const allGood: Probes = {
  hasDocker: async () => true,
  sbxVersion: async () => 'sbx 1.2.3',
  sbxAuthed: async () => true,
  freeDiskBytes: async () => 50 * 1024 ** 3,
  keychainReachable: async () => true
}

describe('checkPrereqs', () => {
  it('passes when docker, sbx, and auth are present', async () => {
    const r = await checkPrereqs(allGood)
    expect(r.ok).toBe(true)
    expect(r.checks.map((c) => c.id)).toEqual(['docker', 'sbx', 'auth', 'disk', 'keychain'])
  })

  it('blocks when sbx is not authenticated', async () => {
    const r = await checkPrereqs({ ...allGood, sbxAuthed: async () => false })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'auth')?.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'auth')?.remediation).toContain('sbx login')
  })

  it('reports low disk without blocking', async () => {
    const r = await checkPrereqs({ ...allGood, freeDiskBytes: async () => 100 * 1024 ** 2 })
    expect(r.ok).toBe(true)
    expect(r.checks.find((c) => c.id === 'disk')?.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/main/prereq.test.ts`
Expected: FAIL — `@main/prereq` not found.

- [ ] **Step 3: Implement the detector**

Create `src/main/prereq.ts`:

```ts
import type { PrereqCheck, PrereqResult } from '@shared/types'

export interface Probes {
  hasDocker(): Promise<boolean>
  sbxVersion(): Promise<string | null>
  sbxAuthed(): Promise<boolean>
  freeDiskBytes(): Promise<number>
  keychainReachable(): Promise<boolean>
}

const GiB = 1024 ** 3

export async function checkPrereqs(probes: Probes, minDiskBytes: number = 2 * GiB): Promise<PrereqResult> {
  const docker = await probes.hasDocker()
  const version = await probes.sbxVersion()
  const authed = version ? await probes.sbxAuthed() : false
  const disk = await probes.freeDiskBytes()
  const keychain = await probes.keychainReachable()

  const checks: PrereqCheck[] = [
    { id: 'docker', label: 'Docker', ok: docker, detail: docker ? 'Docker is available' : 'Docker not found', remediation: docker ? undefined : 'Install Docker Desktop and ensure it is running.' },
    { id: 'sbx', label: 'Docker Sandboxes (sbx)', ok: version !== null, detail: version ?? 'sbx not found on PATH', remediation: version ? undefined : 'Install the Docker Sandboxes CLI (`sbx`).' },
    { id: 'auth', label: 'sbx authentication', ok: authed, detail: authed ? 'Authenticated' : 'Not logged in', remediation: authed ? undefined : 'Run `sbx login` in your terminal, then re-check.' },
    { id: 'disk', label: 'Disk space', ok: disk >= minDiskBytes, detail: `${(disk / GiB).toFixed(1)} GiB free`, remediation: disk >= minDiskBytes ? undefined : 'Free up disk space; sandboxes need room for images.' },
    { id: 'keychain', label: 'OS keychain', ok: keychain, detail: keychain ? 'Reachable' : 'Not reachable — encrypted fallback will be used', remediation: undefined }
  ]

  const ok = checks.filter((c) => c.id === 'docker' || c.id === 'sbx' || c.id === 'auth').every((c) => c.ok)
  return { ok, checks }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/main/prereq.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(prereq): add prerequisite detector (docker/sbx/auth/disk/keychain)"
```

---

### Task 7: IPC bridge (main handlers + preload allowlist)

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts` (wire store/adapter, register handlers)
- Modify: `src/preload/index.ts` (expose typed `window.api`)
- Test: `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: `checkPrereqs` + real `Probes`, `reconcile`, `createSbxAdapter`, `openStore`, `Result<T>`, `PrereqResult`, `InstanceView`.
- Produces:
  - `function buildHandlers(deps: { adapter: SbxAdapter; store: Store; probes: Probes }): { 'prereq:check': () => Promise<Result<PrereqResult>>; 'instances:list': () => Promise<Result<InstanceView[]>> }` — pure factory (no Electron import) so it is unit-testable.
  - `function registerIpc(deps): void` — wraps `buildHandlers` with `ipcMain.handle` (Electron side).
  - `window.api` shape: `{ prereqCheck(): Promise<Result<PrereqResult>>; instancesList(): Promise<Result<InstanceView[]>> }`.

- [ ] **Step 1: Write the failing test for the handler factory**

Create `tests/main/ipc.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildHandlers } from '@main/ipc'
import { openStore } from '@main/store/db'
import type { SbxAdapter } from '@main/sbx/adapter'
import type { Probes } from '@main/prereq'

const adapter: SbxAdapter = {
  runSbx: async () => ({ stdout: '', stderr: '', code: 0 }),
  listSandboxes: async () => [{ name: 'sbx-a', status: 'running', agent: 'claude', ports: [], workspace: '/w' }]
}
const probes: Probes = {
  hasDocker: async () => true, sbxVersion: async () => 'sbx 1.0', sbxAuthed: async () => true,
  freeDiskBytes: async () => 50 * 1024 ** 3, keychainReachable: async () => true
}

describe('buildHandlers', () => {
  it('prereq:check returns a wrapped ok result', async () => {
    const h = buildHandlers({ adapter, store: openStore(':memory:'), probes })
    const res = await h['prereq:check']()
    expect(res).toEqual({ ok: true, data: expect.objectContaining({ ok: true }) })
  })

  it('instances:list returns reconciled views', async () => {
    const h = buildHandlers({ adapter, store: openStore(':memory:'), probes })
    const res = await h['instances:list']()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data[0].name).toBe('sbx-a')
  })

  it('wraps thrown errors as {ok:false}', async () => {
    const boom: SbxAdapter = { ...adapter, listSandboxes: async () => { throw new Error('kaboom') } }
    const h = buildHandlers({ adapter: boom, store: openStore(':memory:'), probes })
    const res = await h['instances:list']()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toBe('kaboom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/main/ipc.test.ts`
Expected: FAIL — `@main/ipc` not found.

- [ ] **Step 3: Implement the handler factory + Electron registration**

Create `src/main/ipc.ts`:

```ts
import { ipcMain } from 'electron'
import type { Result, PrereqResult, InstanceView } from '@shared/types'
import type { SbxAdapter } from './sbx/adapter'
import type { Store } from './store/db'
import { checkPrereqs, type Probes } from './prereq'
import { reconcile } from './reconciler'

interface Deps { adapter: SbxAdapter; store: Store; probes: Probes }

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    const err = e as { kind?: string; message?: string }
    return { ok: false, error: { kind: err.kind ?? 'generic', message: err.message ?? String(e) } }
  }
}

export function buildHandlers(deps: Deps): {
  'prereq:check': () => Promise<Result<PrereqResult>>
  'instances:list': () => Promise<Result<InstanceView[]>>
} {
  return {
    'prereq:check': () => wrap(() => checkPrereqs(deps.probes)),
    'instances:list': () => wrap(() => reconcile(deps.adapter, deps.store))
  }
}

export function registerIpc(deps: Deps): void {
  const handlers = buildHandlers(deps)
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, () => handler())
  }
}
```

Replace `src/preload/index.ts` with:

```ts
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  prereqCheck: () => ipcRenderer.invoke('prereq:check'),
  instancesList: () => ipcRenderer.invoke('instances:list')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

- [ ] **Step 4: Wire real dependencies into the main bootstrap**

Create `src/main/probes.ts`:

```ts
import { spawn } from 'child_process'
import { statfs } from 'fs'
import type { Probes } from './prereq'

function tryCmd(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args)
    let out = ''
    c.stdout?.on('data', (d) => (out += d.toString()))
    c.stderr?.on('data', (d) => (out += d.toString()))
    c.on('error', () => resolve({ code: 127, out: '' }))
    c.on('close', (code) => resolve({ code: code ?? 0, out }))
  })
}

export const systemProbes: Probes = {
  hasDocker: async () => (await tryCmd('docker', ['--version'])).code === 0,
  sbxVersion: async () => {
    const r = await tryCmd('sbx', ['--version'])
    return r.code === 0 ? r.out.trim() : null
  },
  sbxAuthed: async () => (await tryCmd('sbx', ['ls', '--json'])).code === 0,
  freeDiskBytes: () =>
    new Promise((resolve) => {
      statfs(process.env.HOME || '/', (err, s) => resolve(err ? 0 : Number(s.bavail) * Number(s.bsize)))
    }),
  keychainReachable: async () => process.platform === 'darwin' || process.platform === 'win32'
}
```

Modify `src/main/index.ts` — add imports at top and call `registerIpc` inside `app.whenReady().then(...)` before `createWindow()`:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { app as electronApp } from 'electron'
import { openStore } from './store/db'
import { createSbxAdapter } from './sbx/adapter'
import { systemProbes } from './probes'
import { registerIpc } from './ipc'

// ...createWindow() unchanged...

app.whenReady().then(() => {
  const store = openStore(join(electronApp.getPath('userData'), 'sandbox-manager.db'))
  registerIpc({ adapter: createSbxAdapter(), store, probes: systemProbes })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
```

(Remove the duplicate `app.whenReady` block from Task 1 — there must be exactly one.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/main/ipc.test.ts`
Expected: PASS.

- [ ] **Step 6: Rebuild native module for Electron and smoke-launch**

Run: `npm run rebuild && npm run dev`
Expected: the app launches without a `better-sqlite3` ABI error (the DB opens in `userData`). Close it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ipc): add prereq:check and instances:list bridge with typed preload"
```

---

### Task 8: Renderer — theme tokens, IPC client, and Prereq screen

**Files:**
- Create: `src/renderer/theme/tokens.css`
- Create: `src/renderer/ipc/client.ts`
- Create: `src/renderer/screens/Prereq.tsx`
- Test: `tests/renderer/Prereq.test.tsx`

**Interfaces:**
- Consumes: `window.api` (Task 7), `PrereqResult`, `PrereqCheck`.
- Produces:
  - `src/renderer/ipc/client.ts` exporting `const api: Api` typed against `window.api` (falls back safely in tests).
  - `function Prereq({ result, onRecheck }: { result: PrereqResult; onRecheck: () => void }): JSX.Element` — a presentational component (data passed in) so it is deterministic to test. Renders one row per check with a pass/fail badge and remediation text when failing; a "Re-check" button calls `onRecheck`.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/Prereq.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Prereq } from '../../src/renderer/screens/Prereq'
import type { PrereqResult } from '@shared/types'

const failing: PrereqResult = {
  ok: false,
  checks: [
    { id: 'docker', label: 'Docker', ok: true, detail: 'ok' },
    { id: 'auth', label: 'sbx authentication', ok: false, detail: 'Not logged in', remediation: 'Run `sbx login`' }
  ]
}

describe('Prereq screen', () => {
  it('renders each check with its label and remediation for failures', () => {
    render(<Prereq result={failing} onRecheck={() => {}} />)
    expect(screen.getByText('Docker')).toBeInTheDocument()
    expect(screen.getByText('sbx authentication')).toBeInTheDocument()
    expect(screen.getByText(/Run `sbx login`/)).toBeInTheDocument()
  })

  it('invokes onRecheck when the button is clicked', () => {
    const onRecheck = vi.fn()
    render(<Prereq result={failing} onRecheck={onRecheck} />)
    screen.getByRole('button', { name: /re-check/i }).click()
    expect(onRecheck).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/Prereq.test.tsx`
Expected: FAIL — screen component not found.

- [ ] **Step 3: Freeze design tokens**

Create `src/renderer/theme/tokens.css` (values extracted from the mockup `:root`):

```css
:root {
  --bg: #0b0f16;
  --surface: #12161f;
  --border: #232c3a;
  --fg: #e6edf3;
  --muted: #7d8896;
  --accent: #4f8cff;
  --ok: #3fb950;
  --danger: #f85149;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --radius: 10px;
}
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-sans); }
```

- [ ] **Step 4: Implement the IPC client and Prereq screen**

Create `src/renderer/ipc/client.ts`:

```ts
import type { Result, PrereqResult, InstanceView } from '@shared/types'

interface Api {
  prereqCheck(): Promise<Result<PrereqResult>>
  instancesList(): Promise<Result<InstanceView[]>>
}

export const api: Api = (globalThis as unknown as { api?: Api }).api ?? {
  prereqCheck: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  instancesList: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } })
}
```

Create `src/renderer/screens/Prereq.tsx`:

```tsx
import type { PrereqResult } from '@shared/types'

export function Prereq({ result, onRecheck }: { result: PrereqResult; onRecheck: () => void }): JSX.Element {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>System Prerequisites</h1>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {result.checks.map((c) => (
          <li key={c.id} style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: c.ok ? 'var(--ok)' : 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
              {c.ok ? '✓' : '✕'}
            </span>{' '}
            <strong>{c.label}</strong> — <span style={{ color: 'var(--muted)' }}>{c.detail}</span>
            {!c.ok && c.remediation && (
              <div style={{ color: 'var(--muted)', marginTop: 'var(--space-2)' }}>{c.remediation}</div>
            )}
          </li>
        ))}
      </ul>
      <button onClick={onRecheck}>Re-check</button>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/renderer/Prereq.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): add theme tokens, IPC client, and Prereq screen"
```

---

### Task 9: Renderer — Instances screen

**Files:**
- Create: `src/renderer/screens/Instances.tsx`
- Test: `tests/renderer/Instances.test.tsx`

**Interfaces:**
- Consumes: `InstanceView` (Task 2).
- Produces:
  - `function Instances({ instances }: { instances: InstanceView[] }): JSX.Element` — presentational; a table with columns Instance / Status / Definition / Workspace / Agent / Network / Ports; shows an empty state ("No sandboxes yet") when the list is empty. Status renders as a badge; ports join with commas or show "—".

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/Instances.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Instances } from '../../src/renderer/screens/Instances'
import type { InstanceView } from '@shared/types'

const rows: InstanceView[] = [
  { name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/w', ports: ['127.0.0.1:8080->3000/tcp'], definitionId: 'd1', definitionName: 'prj-alpha', tier: 'locked' }
]

describe('Instances screen', () => {
  it('renders a row per instance with its definition and ports', () => {
    render(<Instances instances={rows} />)
    expect(screen.getByText('sbx-a')).toBeInTheDocument()
    expect(screen.getByText('prj-alpha')).toBeInTheDocument()
    expect(screen.getByText('127.0.0.1:8080->3000/tcp')).toBeInTheDocument()
  })

  it('shows the empty state when there are no instances', () => {
    render(<Instances instances={[]} />)
    expect(screen.getByText(/no sandboxes yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/Instances.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the Instances screen**

Create `src/renderer/screens/Instances.tsx`:

```tsx
import type { InstanceView } from '@shared/types'

export function Instances({ instances }: { instances: InstanceView[] }): JSX.Element {
  if (instances.length === 0) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <h1>Instances</h1>
        <p style={{ color: 'var(--muted)' }}>No sandboxes yet. Create a definition and launch an instance to get started.</p>
      </div>
    )
  }
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Instances</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
            <th>Instance</th><th>Status</th><th>Definition</th><th>Workspace</th><th>Agent</th><th>Network</th><th>Ports</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((i) => (
            <tr key={i.name} style={{ borderTop: '1px solid var(--border)' }}>
              <td>{i.name}</td>
              <td>{i.status}</td>
              <td>{i.definitionName ?? '—'}</td>
              <td>{i.workspace ?? '—'}</td>
              <td>{i.agent}</td>
              <td>{i.tier}</td>
              <td>{i.ports.length ? i.ports.join(', ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/renderer/Instances.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add Instances list screen with empty state"
```

---

### Task 10: Wire the app — prereq gate → Instances (walking skeleton)

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/main.tsx` (import tokens.css)
- Test: `tests/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `api` (Task 8), `Prereq` (Task 8), `Instances` (Task 9), `Result`, `PrereqResult`, `InstanceView`.
- Produces: the end-to-end skeleton — on mount, `App` calls `api.prereqCheck()`; if `!ok`, renders `Prereq`; if `ok`, calls `api.instancesList()` and renders `Instances`. This is the runnable deliverable.

- [ ] **Step 1: Write the failing test (mocking the IPC client)**

Create `tests/renderer/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const prereqCheck = vi.fn()
const instancesList = vi.fn()
vi.mock('../../src/renderer/ipc/client', () => ({ api: { prereqCheck: () => prereqCheck(), instancesList: () => instancesList() } }))

import App from '../../src/renderer/App'

beforeEach(() => { prereqCheck.mockReset(); instancesList.mockReset() })

describe('App', () => {
  it('shows the Prereq screen when prerequisites fail', async () => {
    prereqCheck.mockResolvedValue({ ok: true, data: { ok: false, checks: [{ id: 'auth', label: 'sbx authentication', ok: false, detail: 'no', remediation: 'Run `sbx login`' }] } })
    render(<App />)
    await waitFor(() => expect(screen.getByText('System Prerequisites')).toBeInTheDocument())
    expect(instancesList).not.toHaveBeenCalled()
  })

  it('shows Instances when prerequisites pass', async () => {
    prereqCheck.mockResolvedValue({ ok: true, data: { ok: true, checks: [] } })
    instancesList.mockResolvedValue({ ok: true, data: [{ name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/w', ports: [], definitionId: null, definitionName: null, tier: 'custom' }] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Instances')).toBeInTheDocument())
    expect(screen.getByText('sbx-a')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/App.test.tsx`
Expected: FAIL — `App` still renders only the heading from Task 1.

- [ ] **Step 3: Implement the gate-and-route App**

Replace `src/renderer/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { PrereqResult, InstanceView } from '@shared/types'
import { api } from './ipc/client'
import { Prereq } from './screens/Prereq'
import { Instances } from './screens/Instances'

type View =
  | { kind: 'loading' }
  | { kind: 'prereq'; result: PrereqResult }
  | { kind: 'instances'; rows: InstanceView[] }
  | { kind: 'error'; message: string }

export default function App(): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'loading' })

  async function load(): Promise<void> {
    setView({ kind: 'loading' })
    const pre = await api.prereqCheck()
    if (!pre.ok) return setView({ kind: 'error', message: pre.error.message })
    if (!pre.data.ok) return setView({ kind: 'prereq', result: pre.data })
    const list = await api.instancesList()
    if (!list.ok) return setView({ kind: 'error', message: list.error.message })
    setView({ kind: 'instances', rows: list.data })
  }

  useEffect(() => { void load() }, [])

  if (view.kind === 'loading') return <p style={{ padding: 16 }}>Loading…</p>
  if (view.kind === 'error') return <p style={{ padding: 16, color: 'var(--danger)' }}>Error: {view.message}</p>
  if (view.kind === 'prereq') return <Prereq result={view.result} onRecheck={() => void load()} />
  return <Instances instances={view.rows} />
}
```

Modify `src/renderer/main.tsx` to import tokens (add as first import):

```tsx
import './theme/tokens.css'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/renderer/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full test + typecheck sweep**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all suites PASS.

- [ ] **Step 6: End-to-end manual verification**

Run: `npm run dev`
Expected — one of:
- If `sbx` is not installed/authenticated: the **Prereq** screen lists the failing checks with remediation.
- If `sbx` is installed and authenticated: the **Instances** screen lists the machine's real sandboxes (or the empty state).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire prereq gate to instances list (phase 1 walking skeleton)"
```

---

## Self-Review

**1. Spec coverage (design doc §1–§9 → tasks):**
- Tech stack (Electron/React/Vite/TS, better-sqlite3) → Task 1, 4. ✓
- `#sbx-adapter` single choke point, JSON-first/text fallback → Tasks 2, 3. ✓
- `#metadata-store` (definitions + instance meta; no secret-value column) → Task 4. ✓
- `#reconciler` (sbx wins; external instances; orphan GC) → Task 5. ✓
- `#prereq-detector` (docker/sbx/auth/disk/keychain) → Task 6. ✓
- IPC bridge with `{ok,data}|{ok,error}` shape + contextIsolation → Task 7. ✓
- Prereq + Instances screens; frozen tokens → Tasks 8, 9. ✓
- Launch reconciliation flow (startup gate → reconcile) → Task 10. ✓
- **Deferred to later phases (correctly out of Phase 1 scope):** Definitions wizard (Phase 2), launch/lifecycle + policy/ports/credentials at launch (Phase 3), terminals (Phase 4), live policy/ports editors (Phase 5), credential manager + monitoring (Phase 6), packaging/Settings (Phase 7).

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code; every test step contains real assertions and an explicit expected result. ✓

**3. Type consistency:** `SbxInstance`, `InstanceView`, `Definition`, `InstanceMeta`, `PrereqResult`, `Result<T>` are defined once in `src/shared/types.ts` (Task 2) and consumed unchanged in Tasks 3–10. `SbxAdapter`/`SpawnFn` defined in Task 3 and consumed in Tasks 5, 7. `Store` defined in Task 4 and consumed in Tasks 5, 7. `Probes`/`checkPrereqs` defined in Task 6 and consumed in Task 7. `window.api` (Task 7 preload) matches the `Api` interface in `ipc/client.ts` (Task 8) and the mock in Task 10. ✓

**4. Ambiguity:** `sbx ls --json` support is unverified (design doc open item); handled by the JSON-first-then-text-fallback path in Tasks 2–3 so either behavior works. Column parsing assumes 2+-space separation; tested against the documented layout.

---

## Notes for later phases

- The `--json` availability question resolves itself operationally here (fallback covers both); if `sbx ls` never emits JSON, delete `parseSbxLsJson` usage in a later cleanup.
- `node-pty` (Phase 4) and additional native rebuilds join the `npm run rebuild` script then.
- The presentational screens (`Prereq`, `Instances`) take data via props specifically so Phase 2+ can wrap them with navigation (the mockup's `nav-*` sidebar) without rewriting them.
