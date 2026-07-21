# "Open in VS Code" Launch Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-launch "Open with: Terminal / VS Code" choice (applied to Launch and Attach) that opens the sandbox session in a VS Code window on the working directory — the agent's file edits show live and the session runs in VS Code's integrated terminal.

**Architecture:** A pure `.code-workspace` generator + a `code` opener (new `src/main/vscode.ts`, parallel to `terminal.ts`); an `opener` argument threaded through `launchDefinition` and the launch/attach IPC; renderer opener controls in `LaunchDialog` and a small `OpenWithDialog` for attach.

**Tech Stack:** Electron (main/preload/renderer), electron-vite, React 18 + TS strict, better-sqlite3, Vitest + @testing-library/react. Only `SbxAdapter` spawns `sbx`; `terminal.ts`/`vscode.ts` are the OS-launch choke points.

## Global Constraints

- **Run tests with `npm test`** (pretest hook flips the better-sqlite3 ABI); never bare `npx vitest`.
- **Mechanism (spike-confirmed):** generate `<workspaceDir>/.sandbox/<name>.code-workspace` with `folders`, `settings: { "task.allowAutomaticTasks": "on" }`, and a `runOn: folderOpen` task running the sbx chain; then `code <file>`. Auto-runs in a **trusted** folder; a never-opened folder needs a one-time trust click (VS Code Workspace Trust) — graceful degradation covers it.
- **`opener` type:** `'terminal' | 'vscode'`, default `'terminal'`. Everything falls back to Terminal.app when VS Code is unavailable, the workspace dir can't be resolved, or the file write fails — never fail the launch.
- **No secret ever reaches the workspace file** — it contains only the sbx chain (secrets are registered separately, pre-launch).
- **`.sandbox/` is already gitignored** (kit writer ensures it). The workspace file lives there.
- **i18n parity:** every new key in BOTH `en.ts` and `de.ts` (Dict type enforces it).
- Branch: `phase-11-vscode-launcher` (already created off `main`).

---

### Task 1: VS Code opener module (`buildCodeWorkspace` + `codeCliPresent` + `openInVSCode`)

**Files:**
- Create: `src/main/vscode.ts`
- Test: `tests/main/vscode/vscode.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export function buildCodeWorkspace(workspaceDir: string, sandboxName: string, command: string): string // JSON text
  export function codeCliPresent(run?: (cmd: string, args: string[]) => { status: number | null }): boolean
  export function openInVSCode(workspaceFile: string, spawn?: (cmd: string, args: string[]) => void): void
  ```
- Consumed by: Task 2 (launch), Task 3 (IPC/index wiring).

- [ ] **Step 1: Write the failing test**

Create `tests/main/vscode/vscode.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildCodeWorkspace, codeCliPresent, openInVSCode } from '../../../src/main/vscode'

describe('buildCodeWorkspace', () => {
  const json = buildCodeWorkspace('/home/u/alpha', 'my-project', 'sbx create claude /home/u/alpha && sbx run --name my-project')
  const obj = JSON.parse(json)
  it('points at the workspace folder', () => {
    expect(obj.folders).toEqual([{ path: '/home/u/alpha' }])
  })
  it('allows automatic tasks so the folderOpen task runs without a prompt', () => {
    expect(obj.settings['task.allowAutomaticTasks']).toBe('on')
  })
  it('runs the sbx chain via a folderOpen task', () => {
    const task = obj.tasks.tasks[0]
    expect(task.runOptions.runOn).toBe('folderOpen')
    expect(task.command).toContain('sbx run --name my-project')
    expect(task.label).toBe('AI Sandbox: my-project')
  })
})

describe('codeCliPresent', () => {
  it('true when `code --version` exits 0', () => {
    expect(codeCliPresent(() => ({ status: 0 }))).toBe(true)
  })
  it('false when it errors or is missing', () => {
    expect(codeCliPresent(() => ({ status: 1 }))).toBe(false)
    expect(codeCliPresent(() => { throw new Error('ENOENT') })).toBe(false)
  })
})

describe('openInVSCode', () => {
  it('spawns `code <workspaceFile>`', () => {
    const spawn = vi.fn()
    openInVSCode('/home/u/alpha/.sandbox/my-project.code-workspace', spawn)
    expect(spawn).toHaveBeenCalledWith('code', ['/home/u/alpha/.sandbox/my-project.code-workspace'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- vscode/vscode`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/main/vscode.ts`**

```ts
import { spawn as nodeSpawn, spawnSync } from 'child_process'
import { SbxError } from '@shared/errors'

/**
 * Build a throwaway VS Code workspace file that opens `workspaceDir` and auto-runs
 * `command` (the sbx chain) in an integrated terminal via a folderOpen task. The
 * `task.allowAutomaticTasks` setting removes the automatic-tasks prompt; VS Code
 * Workspace Trust still applies on a never-opened folder (one-time click).
 */
export function buildCodeWorkspace(workspaceDir: string, sandboxName: string, command: string): string {
  return JSON.stringify({
    folders: [{ path: workspaceDir }],
    settings: { 'task.allowAutomaticTasks': 'on' },
    tasks: {
      version: '2.0.0',
      tasks: [{
        label: `AI Sandbox: ${sandboxName}`,
        type: 'shell',
        command,
        runOptions: { runOn: 'folderOpen' },
        presentation: { panel: 'dedicated', focus: true },
        problemMatcher: []
      }]
    }
  }, null, 2)
}

/** Whether the `code` CLI is on PATH (checked per-use; cheap). */
export function codeCliPresent(run: (cmd: string, args: string[]) => { status: number | null } = (c, a) => spawnSync(c, a, { stdio: 'ignore' })): boolean {
  try {
    return run('code', ['--version']).status === 0
  } catch {
    return false
  }
}

export type SpawnCodeFn = (cmd: string, args: string[]) => void
const defaultSpawn: SpawnCodeFn = (cmd, args) => {
  const child = nodeSpawn(cmd, args, { stdio: 'ignore', detached: true })
  child.unref()
}

export function openInVSCode(workspaceFile: string, spawn: SpawnCodeFn = defaultSpawn): void {
  spawn('code', [workspaceFile])
}
```

(The `SbxError` import may be unused — drop it if so to keep the linter clean.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- vscode/vscode`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/vscode.ts tests/main/vscode/vscode.test.ts
git commit -m "feat(vscode): .code-workspace generator + code CLI detect + opener"
```

---

### Task 2: `launchDefinition` opener support

**Files:**
- Modify: `src/main/launch.ts`
- Test: `tests/main/launch.test.ts` (additions)

**Interfaces:**
- Consumes: Task 1 (via a `deps.openVSCode` injection — launch stays sbx/opener-agnostic).
- Produces: `launchDefinition(deps, definitionId, requestedName?, sessionName?, opener?)` where `opener: 'terminal' | 'vscode'`. `LaunchDeps` gains `openVSCode?: (command: string, workspaceDir: string, sandboxName: string) => void`.

- [ ] **Step 1: Write the failing test**

In `tests/main/launch.test.ts`: add `openVSCode` to the `deps()` helper's returned adapter/deps and a test.

In `deps()`, add:
```ts
const openVSCode = vi.fn()
```
add `openVSCode` to the returned object and pass it into the deps used by `launchDefinition` (the test calls `launchDefinition(d as never, 'd1', …)`; ensure `d` includes `openVSCode`).

Add tests:
```ts
it('opens VS Code (not the terminal) when opener is vscode and a workspace dir exists', async () => {
  const d = deps(() => spec)
  await launchDefinition(d as never, 'd1', undefined, undefined, 'vscode')
  expect(d.openVSCode).toHaveBeenCalledTimes(1)
  const [command, workspaceDir, name] = d.openVSCode.mock.calls[0]
  expect(workspaceDir).toBe('/p')            // primary mount hostPath from `spec`
  expect(name).toBe('my-project')
  expect(command).toContain('sbx run --name my-project')
  expect(d.openTerminal).not.toHaveBeenCalled()
})
it('falls back to the terminal when opener is vscode but openVSCode dep is absent', async () => {
  const d = deps(() => spec); (d as { openVSCode?: unknown }).openVSCode = undefined
  await launchDefinition(d as never, 'd1', undefined, undefined, 'vscode')
  expect(d.openTerminal).toHaveBeenCalledTimes(1)
})
it('uses the terminal for the default opener', async () => {
  const d = deps(() => spec)
  await launchDefinition(d as never, 'd1')
  expect(d.openTerminal).toHaveBeenCalledTimes(1)
  expect(d.openVSCode).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- launch`
Expected: FAIL — 5th param + `openVSCode` not handled.

- [ ] **Step 3: Implement**

In `src/main/launch.ts`:
- Add to `LaunchDeps`: `openVSCode?: (command: string, workspaceDir: string, sandboxName: string) => void`.
- Change the signature: `export async function launchDefinition(deps, definitionId, requestedName?, sessionName?, opener: 'terminal' | 'vscode' = 'terminal')`.
- Replace the final `deps.openTerminal(command)` with:
  ```ts
  const primary = spec.mounts.find((m) => m.isPrimary) ?? spec.mounts[0]
  const workspaceDir = primary?.hostPath?.trim()
  if (opener === 'vscode' && deps.openVSCode && workspaceDir) {
    deps.log?.info(`Opening VS Code at ${workspaceDir} (session in integrated terminal) for "${name}".`)
    deps.openVSCode(command, workspaceDir, name)
  } else {
    if (opener === 'vscode') deps.log?.info('VS Code opener unavailable; falling back to Terminal.')
    deps.openTerminal(command)
  }
  ```
  (Keep the existing `upsertInstanceMeta` call before opening, unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- launch`
Expected: PASS (existing launch tests unaffected — default opener = terminal).

- [ ] **Step 5: Commit**

```bash
git add src/main/launch.ts tests/main/launch.test.ts
git commit -m "feat(vscode): launchDefinition routes to VS Code opener when chosen"
```

---

### Task 3: IPC + index wiring (launch/attach opener, env:hasVSCode)

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/ipc/client.ts`
- Test: `tests/main/ipc.test.ts` (additions)

**Interfaces:**
- IPC: `instance:launch(defId, name?, sessionName?, opener?)`, `instance:attach(name, opener?)`, `env:hasVSCode() → Result<{ present: boolean }>`.
- Deps gain `openVSCode?: (command, workspaceDir, name) => void`.

- [ ] **Step 1: Write the failing test**

In `tests/main/ipc.test.ts` add:
```ts
it('env:hasVSCode reports code availability', async () => {
  const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {} })
  const r = await h['env:hasVSCode']()
  expect(r.ok).toBe(true)
  if (r.ok) expect(typeof r.data.present).toBe('boolean')
})
it('instance:attach with vscode opener resolves the workspace and opens VS Code', async () => {
  const store = openStore(":memory:")
  store.insertDefinitionSpec({
    definition: { id: 'd', name: 'n', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
    mounts: [{ hostPath: '/ws', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
  })
  store.upsertInstanceMeta({ sbxName: 'box', definitionId: 'd', createdByApp: true, createdAt: 't' })
  const openVSCode = vi.fn()
  const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, openVSCode })
  await h['instance:attach']('box', 'vscode')
  expect(openVSCode).toHaveBeenCalledTimes(1)
  expect(openVSCode.mock.calls[0][1]).toBe('/ws')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/main/ipc.test.ts`
Expected: FAIL — handlers/param missing.

- [ ] **Step 3: Implement in `ipc.ts`**

- Import: `import { codeCliPresent } from './vscode'` and (already) `agentAttachCommand`.
- `Deps`: add `openVSCode?: (command: string, workspaceDir: string, sandboxName: string) => void`.
- Return-type additions:
  ```ts
  'env:hasVSCode': () => Promise<Result<{ present: boolean }>>
  ```
  and update `'instance:launch'` and `'instance:attach'` signatures to accept `opener?: 'terminal' | 'vscode'`.
- `instance:launch` handler: pass `opener` and `openVSCode` into `launchDefinition`:
  ```ts
  'instance:launch': (definitionId, name, sessionName, opener) => wrap(() => launchDefinition(
    { adapter: deps.adapter, store: deps.store, creds: deps.creds ?? { getStaged: () => null },
      materializeKit: deps.materializeKit ?? (() => undefined), openTerminal: deps.openTerminal,
      openVSCode: deps.openVSCode, log: deps.log },
    definitionId, name, sessionName, opener ?? 'terminal'
  )),
  ```
- `instance:attach` handler: honor opener:
  ```ts
  'instance:attach': (name, opener) => wrap(async () => {
    const cmd = agentAttachCommand(name)
    const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
    const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
    const workspaceDir = (spec?.mounts.find((m) => m.isPrimary) ?? spec?.mounts[0])?.hostPath?.trim()
    if (opener === 'vscode' && deps.openVSCode && workspaceDir) {
      deps.log?.info(`Opening VS Code at ${workspaceDir} to attach "${name}"`)
      deps.openVSCode(cmd, workspaceDir, name)
    } else {
      deps.log?.info(`Opening agent terminal: ${cmd}`)
      deps.openTerminal(cmd)
    }
    return null
  }),
  ```
- Add the env handler: `'env:hasVSCode': () => wrap(async () => ({ present: codeCliPresent() })),`.
- Registrations:
  ```ts
  ipcMain.handle('instance:launch', (_e, id, name, sessionName, opener) => handlers['instance:launch'](id, name, sessionName, opener))
  ipcMain.handle('instance:attach', (_e, name, opener) => handlers['instance:attach'](name, opener))
  ipcMain.handle('env:hasVSCode', () => handlers['env:hasVSCode']())
  ```
  (Replace the existing `instance:launch`/`instance:attach` registrations.)

- [ ] **Step 4: Wire `openVSCode` in `index.ts`**

Add import `import { buildCodeWorkspace, openInVSCode } from './vscode'` and a function:
```ts
function openVSCode(command: string, workspaceDir: string, sandboxName: string): void {
  const kitDir = `${workspaceDir}/.sandbox`
  nodeFs.mkdirSync(kitDir, { recursive: true })
  const file = `${kitDir}/${sandboxName}.code-workspace`
  nodeFs.writeFileSync(file, buildCodeWorkspace(workspaceDir, sandboxName, command), { mode: 0o644 })
  openInVSCode(file)
}
```
Pass `openVSCode` into `registerIpc({ …, openVSCode, log: logger })`.

- [ ] **Step 5: preload + client**

Preload: update `instanceLaunch`/`instanceAttach` to forward `opener`, add `envHasVSCode`:
```ts
instanceLaunch: (definitionId, name, sessionName, opener) => ipcRenderer.invoke('instance:launch', definitionId, name, sessionName, opener),
instanceAttach: (name, opener) => ipcRenderer.invoke('instance:attach', name, opener),
envHasVSCode: () => ipcRenderer.invoke('env:hasVSCode'),
```
Client interface + fallback: add `opener?: 'terminal' | 'vscode'` to `instanceLaunch`/`instanceAttach`; add `envHasVSCode(): Promise<Result<{ present: boolean }>>` (fallback `{ ok: true, data: { present: false } }`).

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- tests/main/ipc.test.ts launch` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc.test.ts
git commit -m "feat(vscode): launch/attach opener IPC + env:hasVSCode + index wiring"
```

---

### Task 4: LaunchDialog opener toggle + App wiring

**Files:**
- Modify: `src/renderer/components/LaunchDialog.tsx`, `src/renderer/App.tsx`, `src/renderer/i18n/en.ts`, `de.ts`
- Test: `tests/renderer/LaunchDialog.test.tsx`

**Interfaces:**
- `LaunchDialog` props gain `hasVSCode: boolean`, `cloneMode: boolean`, and `onLaunch(sessionName: string, opener: 'terminal' | 'vscode')`.

- [ ] **Step 1: Add i18n keys (en + de)**

In `launch` group (en): `openWith: 'Open with'`, `openTerminal: 'Terminal'`, `openVSCode: 'VS Code'`, `openVSCodeUnavailable: 'VS Code CLI (code) not found on PATH', `, `openVSCodeCloneNote: 'VS Code shows the host folder; in clone mode the agent edits an in-container copy, so changes appear via the sandbox-<name> git remote, not live.'`. German equivalents in `de.ts`.

- [ ] **Step 2: Write the failing test**

In `tests/renderer/LaunchDialog.test.tsx` (create if absent; else extend). Minimal:
```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LaunchDialog } from '../../src/renderer/components/LaunchDialog'
const def = { id: 'd', name: 'My Project', description: '', baseImage: 'i', tier: 'locked', createdAt: 't' } as any

it('defaults to Terminal and launches with the chosen opener', () => {
  const onLaunch = vi.fn()
  render(<LaunchDialog definition={def} hasVSCode cloneMode={false} onLaunch={onLaunch} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
  expect(onLaunch).toHaveBeenCalledWith('', 'terminal')
  fireEvent.click(screen.getByLabelText('VS Code'))
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
  expect(onLaunch).toHaveBeenLastCalledWith('', 'vscode')
})
it('disables VS Code when unavailable', () => {
  render(<LaunchDialog definition={def} hasVSCode={false} cloneMode={false} onLaunch={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByLabelText('VS Code')).toBeDisabled()
})
```
(Use `screen.getByRole`/`getByLabelText` matching the impl below. If `LaunchDialog.test.tsx` already exists with other tests, keep them and update the render calls to include the new props.)

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- LaunchDialog`
Expected: FAIL.

- [ ] **Step 4: Implement in `LaunchDialog.tsx`**

- Add props `hasVSCode: boolean`, `cloneMode: boolean`; change `onLaunch` to `(sessionName: string, opener: 'terminal' | 'vscode') => void`.
- Add `const [opener, setOpener] = useState<'terminal' | 'vscode'>('terminal')`.
- `submit()` → `onLaunch(sessionName.trim(), opener)`.
- Add, above the actions, an "Open with" radio pair:
  ```tsx
  <label style={labelStyle}>{t('launch.openWith')}</label>
  <div role="radiogroup" style={{ display: 'flex', gap: 'var(--space-4)' }}>
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <input type="radio" aria-label="Terminal" name="opener" checked={opener === 'terminal'} onChange={() => setOpener('terminal')} />
      {t('launch.openTerminal')}
    </label>
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: hasVSCode ? 1 : 0.5 }}>
      <input type="radio" aria-label="VS Code" name="opener" disabled={!hasVSCode} checked={opener === 'vscode'} onChange={() => setOpener('vscode')} />
      {t('launch.openVSCode')}
    </label>
  </div>
  {!hasVSCode && <p className="section-desc" style={{ fontSize: 11, margin: '4px 0 0' }}>{t('launch.openVSCodeUnavailable')}</p>}
  {opener === 'vscode' && cloneMode && <p className="section-desc" style={{ fontSize: 11, margin: '4px 0 0' }}>{t('launch.openVSCodeCloneNote')}</p>}
  ```

- [ ] **Step 5: Wire App.tsx**

- Add state: `const [hasVSCode, setHasVSCode] = useState(false)`; fetch once in an effect: `useEffect(() => { void api.envHasVSCode().then((r) => { if (r.ok) setHasVSCode(r.data.present) }) }, [])`.
- Add `const [launchCloneMode, setLaunchCloneMode] = useState(false)`. In `openLaunchDialog`, after the auth precheck, fetch the spec to derive clone mode:
  ```ts
  const specR = await api.defGetSpec(def.id)
  setLaunchCloneMode(specR.ok && !!specR.data && (specR.data.mounts.find((m) => m.isPrimary) ?? specR.data.mounts[0])?.mode === 'clone')
  ```
- `submitLaunch(definition, sessionName, opener)` → `api.instanceLaunch(definition.id, undefined, sessionName, opener)`.
- Update the render: `<LaunchDialog … hasVSCode={hasVSCode} cloneMode={launchCloneMode} onLaunch={(session, opener) => void submitLaunch(launchFor, session, opener)} />`.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- LaunchDialog App` then `npm run typecheck`
Expected: PASS; typecheck clean. (Update any existing App/LaunchDialog test mocks to add `envHasVSCode: async () => ({ ok: true, data: { present: false } })` and the new `onLaunch` arity / `instanceLaunch` opener arg.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/LaunchDialog.tsx src/renderer/App.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/LaunchDialog.test.tsx tests/renderer/App.launch.test.tsx
git commit -m "feat(vscode): Open-with toggle in the Launch dialog + clone-mode note"
```

---

### Task 5: Attach opener (OpenWithDialog + App wiring)

**Files:**
- Create: `src/renderer/components/OpenWithDialog.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/i18n/en.ts`, `de.ts`
- Test: `tests/renderer/OpenWithDialog.test.tsx` (new)

**Interfaces:**
- `OpenWithDialog` props: `title: string`, `hasVSCode: boolean`, `onChoose(opener: 'terminal' | 'vscode')`, `onCancel()`.
- App intercepts `onAttach(name)` → shows the dialog → `api.instanceAttach(name, opener)`.

- [ ] **Step 1: Add i18n keys (en + de)**

In a small `openWith` group (top-level or under `launch`): `attachTitle: 'Open agent session for “{name}”'`, plus reuse `launch.openTerminal`/`launch.openVSCode`/`launch.openVSCodeUnavailable`. Add German.

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/OpenWithDialog.test.tsx`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OpenWithDialog } from '../../src/renderer/components/OpenWithDialog'

it('chooses terminal or vscode', () => {
  const onChoose = vi.fn()
  render(<OpenWithDialog title="Open agent session" hasVSCode onChoose={onChoose} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
  expect(onChoose).toHaveBeenCalledWith('terminal')
  fireEvent.click(screen.getByRole('button', { name: /^vs code$/i }))
  expect(onChoose).toHaveBeenCalledWith('vscode')
})
it('disables VS Code when unavailable', () => {
  render(<OpenWithDialog title="x" hasVSCode={false} onChoose={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByRole('button', { name: /^vs code$/i })).toBeDisabled()
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- OpenWithDialog`
Expected: FAIL — component missing.

- [ ] **Step 4: Implement `OpenWithDialog.tsx`**

```tsx
import { useT } from '../i18n'

export function OpenWithDialog({ title, hasVSCode, onChoose, onCancel }: {
  title: string
  hasVSCode: boolean
  onChoose: (opener: 'terminal' | 'vscode') => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <div className="modal-actions" style={{ marginTop: 'var(--space-4)', gap: 'var(--space-2)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>{t('launch.cancel')}</button>
          <button className="btn btn-secondary" disabled={!hasVSCode} onClick={() => onChoose('vscode')}>{t('launch.openVSCode')}</button>
          <button className="btn btn-primary" onClick={() => onChoose('terminal')}>{t('launch.openTerminal')}</button>
        </div>
        {!hasVSCode && <p className="section-desc" style={{ fontSize: 11, margin: '8px 0 0' }}>{t('launch.openVSCodeUnavailable')}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire App.tsx**

- Add `const [attachFor, setAttachFor] = useState<string | null>(null)`.
- Change `onAttach` to open the chooser: `function onAttach(name: string): void { setAttachFor(name) }`.
- Render near the other dialogs:
  ```tsx
  {attachFor && (
    <OpenWithDialog
      title={t('openWith.attachTitle', { name: attachFor })}
      hasVSCode={hasVSCode}
      onChoose={(opener) => { const n = attachFor; setAttachFor(null); void runAction(api.instanceAttach(n, opener)) }}
      onCancel={() => setAttachFor(null)}
    />
  )}
  ```
- Import `OpenWithDialog`.

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npm test -- OpenWithDialog App` then `npm run typecheck` then `npm run build`
Expected: PASS; typecheck clean; build succeeds. (Update App test mocks: `instanceAttach` now takes an optional opener; the existing attach test clicks Attach → now opens the chooser, so update it to click through the dialog, or assert the dialog appears.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/OpenWithDialog.tsx src/renderer/App.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/OpenWithDialog.test.tsx tests/renderer/App.launch.test.tsx
git commit -m "feat(vscode): Open-with chooser for attach / open agent session"
```

---

### Task 6: Full verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Typecheck** — `npm run typecheck` (clean).
- [ ] **Step 2: Full suite** — `npm test` (all green; fix any fixtures that construct `DefinitionSpec` or mock `api` for the new methods).
- [ ] **Step 3: Build** — `npm run build` (succeeds).
- [ ] **Step 4: Manual smoke (optional, needs you)** — launch a definition with "Open with: VS Code": VS Code opens on the workspace; in a trusted folder the agent session auto-runs in the integrated terminal and edits show live; a never-opened folder shows a one-time trust prompt, then works.
- [ ] **Step 5: Finish** — announce and use `superpowers:finishing-a-development-branch`; verify tests; present merge/PR options.

---

## Self-Review

**Spec coverage:** A (choice) → Tasks 4, 5. B (mechanism) → Task 1. C (launch wiring) → Tasks 2, 3. D (attach) → Tasks 3, 5. E (interfaces) → Tasks 1–5. F/testing → each task + Task 6. All covered.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `opener: 'terminal' | 'vscode'` is used identically in `launchDefinition` (Task 2), IPC (Task 3), preload/client (Task 3), and both renderer dialogs (Tasks 4, 5). `openVSCode(command, workspaceDir, sandboxName)` signature matches across `launch.ts`, `ipc.ts`, `index.ts`, and the tests. `buildCodeWorkspace(workspaceDir, sandboxName, command)` matches Task 1 impl/test and the `index.ts` caller. `env:hasVSCode` / `envHasVSCode` naming consistent across main, preload, client. Every failure path falls back to `openTerminal`.
