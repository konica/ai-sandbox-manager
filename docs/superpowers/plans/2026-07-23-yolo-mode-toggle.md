# Yolo-Mode Toggle (Launch & Re-attach) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user enable/disable Yolo mode (the agent skipping permission prompts) each time they start or re-attach an instance — a per-action checkbox, default ON (today's behavior).

**Architecture:** Yolo is the sandbox's default (via `IS_SANDBOX=1`), not set by our code. Control it by appending a Claude Code flag after the `sbx run … --` separator: ON appends nothing (unchanged command); OFF appends `--permission-mode default`. A `yolo` boolean threads UI → IPC → command builders.

**Tech Stack:** TypeScript (strict), React 18, Electron IPC (main + preload + renderer client), Vitest + @testing-library/react.

## Global Constraints

- **Additive-only flag:** ON must produce the *exact* current command (append nothing). OFF appends `--permission-mode default` after `--`. Do NOT modify existing ON-default test assertions.
- **`yolo` is optional, default `true`** on `yoloAgentArgs` consumers — `launchCommand`, `agentAttachCommand`, `launchDefinition` — so `rebuild` and existing callers keep current behavior.
- **Default ON in every UI control**, preserving today's behavior unless the user opts out.
- **i18n parity:** every key added to `en.ts` must be added to `de.ts` (typecheck enforces `de: Dict = typeof en`).
- **`instance:rebuild` is unchanged** (implicitly ON). Scope is launch + attach only.
- The `--` separator is emitted exactly once, only when there is ≥1 agent arg.

---

### Task 1: Command builders — `yoloAgentArgs`, thread `yolo` into launch/attach

**Files:**
- Modify: `src/main/sbx/translate.ts`
- Test: `tests/main/sbx/translate.test.ts`

**Interfaces:**
- Produces: `yoloAgentArgs(yolo: boolean): string[]`; `launchCommand(spec, name?, sessionName?, kitDir?, yolo?=true): string`; `agentAttachCommand(name: string, yolo?=true): string`.

- [ ] **Step 1: Write the failing tests**

In `tests/main/sbx/translate.test.ts`, add `yoloAgentArgs` to the import list (line 2-16 block) and append this describe at the end of the file:

```ts
describe('yolo permission args', () => {
  it('ON appends nothing; OFF forces --permission-mode default', () => {
    expect(yoloAgentArgs(true)).toEqual([])
    expect(yoloAgentArgs(false)).toEqual(['--permission-mode', 'default'])
  })
  it('agentAttachCommand: OFF adds the flag after --continue with a single --', () => {
    expect(agentAttachCommand('my-project', true)).toBe("sbx run --name 'my-project' -- --continue")
    expect(agentAttachCommand('my-project', false)).toBe("sbx run --name 'my-project' -- --continue --permission-mode default")
  })
  it('launchCommand: OFF appends --permission-mode default after --', () => {
    expect(launchCommand(spec(), 'my-project', undefined, undefined, false))
      .toMatch(/&& sbx run --name my-project -- --permission-mode default$/)
  })
  it('launchCommand: OFF with a session name keeps one -- then session then flag', () => {
    expect(launchCommand(spec(), 'my-project', 'Refactor auth', undefined, false))
      .toMatch(/&& sbx run --name my-project -- --name 'Refactor auth' --permission-mode default$/)
  })
})
```

Update the import block to add `yoloAgentArgs` (alongside `launchCommand`, `agentAttachCommand`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- translate`
Expected: FAIL — `yoloAgentArgs` is not exported; `agentAttachCommand`/`launchCommand` ignore the new arg.

- [ ] **Step 3: Add `yoloAgentArgs` and thread it in**

In `src/main/sbx/translate.ts`:

Add the helper (place it just above `agentAttachCommand`, after `shellQuote`):
```ts
/**
 * Claude Code permission args appended after the `sbx run … --` separator.
 * Yolo ON adds nothing — the sandbox already defaults to bypass (IS_SANDBOX=1);
 * Yolo OFF forces normal permission prompting.
 */
export function yoloAgentArgs(yolo: boolean): string[] {
  return yolo ? [] : ['--permission-mode', 'default']
}
```

Replace `agentAttachCommand`:
```ts
export function agentAttachCommand(name: string, yolo = true): string {
  const agentArgs = ['--continue', ...yoloAgentArgs(yolo)]
  return `sbx run --name ${shellQuote(name)} -- ${agentArgs.join(' ')}`
}
```

In `launchCommand`, add the `yolo` parameter and rebuild the run step. Change the signature line to:
```ts
export function launchCommand(spec: DefinitionSpec, name: string = resolveSandboxName(spec), sessionName?: string, kitDir?: string, yolo = true): string {
```
Replace the current run-step block:
```ts
  const runArgs = ['sbx', 'run', '--name', name]
  if (sessionName && sessionName.trim()) runArgs.push('--', '--name', sessionName.trim())
  steps.push(shellCommand(runArgs))
```
with:
```ts
  // Agent args go after a single `--`: optional session name, then the (possibly
  // empty) yolo permission flag. Emit `--` only when there is at least one arg.
  const runArgs = ['sbx', 'run', '--name', name]
  const agentArgs: string[] = []
  if (sessionName && sessionName.trim()) agentArgs.push('--name', sessionName.trim())
  agentArgs.push(...yoloAgentArgs(yolo))
  if (agentArgs.length) runArgs.push('--', ...agentArgs)
  steps.push(shellCommand(runArgs))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- translate`
Expected: PASS — new cases pass AND all pre-existing assertions (ON-default, session name, ports, open tier) stay green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean. `yolo` is optional with a default, so existing callers that pass 4 args to `launchCommand` / one arg to `agentAttachCommand` still typecheck. (Do NOT edit callers in this task — Task 2 wires the UI value through.)

- [ ] **Step 6: Commit**

```bash
git add src/main/sbx/translate.ts tests/main/sbx/translate.test.ts
git commit -m "feat(launch): yoloAgentArgs + thread yolo into launch/attach commands"
```

---

### Task 2: Thread `yolo` through main → IPC → preload → renderer client

**Files:**
- Modify: `src/main/launch.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/ipc/client.ts`
- Test: `tests/main/launch.test.ts`

**Interfaces:**
- Consumes: `launchCommand(..., yolo)`, `agentAttachCommand(name, yolo)` (Task 1).
- Produces: `launchDefinition(deps, definitionId, requestedName?, sessionName?, opener?, yolo?=true)`; IPC `instance:launch(definitionId, name?, sessionName?, opener?, yolo?)` and `instance:attach(name, opener?, yolo?)` carry a `yolo` boolean end-to-end.

- [ ] **Step 1: Write the failing test**

In `tests/main/launch.test.ts`, add a case asserting `yolo:false` reaches the command. After the existing `describe('launchDefinition', …)` cases add:

```ts
  it('passes yolo=false through to the launch command (--permission-mode default)', async () => {
    const d = deps()
    await launchDefinition(d as never, 'd1', undefined, undefined, 'terminal', false)
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain('-- --permission-mode default')
  })
  it('defaults to yolo ON (no permission flag) when not specified', async () => {
    const d = deps()
    await launchDefinition(d as never, 'd1')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).not.toContain('--permission-mode')
  })
```
(Reuse the file's existing `deps()` helper and `d1` definition fixture — match how the other cases construct them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- launch.test`
Expected: FAIL — `launchDefinition` doesn't accept a 6th arg / ignores it.

- [ ] **Step 3: Add `yolo` to `launchDefinition`**

In `src/main/launch.ts`, extend the signature (after `opener`):
```ts
  opener: 'terminal' | 'vscode' = 'terminal',
  yolo = true
): Promise<{ name: string }> {
```
And pass it to `launchCommand` (line ~77):
```ts
  const command = launchCommand(spec, name, sessionName, kitDir, yolo)
```

- [ ] **Step 4: Thread `yolo` through IPC handlers**

In `src/main/ipc.ts`:

Update the `Handlers` type entries (the `instance:launch` / `instance:attach` lines ~69-70):
```ts
  'instance:launch': (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', yolo?: boolean) => Promise<Result<{ name: string }>>
  'instance:attach': (name: string, opener?: 'terminal' | 'vscode', yolo?: boolean) => Promise<Result<null>>
```
(Leave `instance:rebuild` unchanged.)

Update the handler bodies:
```ts
    'instance:launch': (definitionId, name, sessionName, opener, yolo) => wrap(() => launchDefinition(
      launchDeps(),
      definitionId, name, sessionName, opener ?? 'terminal', yolo ?? true
    )),
    'instance:attach': (name, opener, yolo) => wrap(async () => {
      const cmd = agentAttachCommand(name, yolo ?? true)
      // …rest of the existing body unchanged…
```
(Only the first line of `instance:attach` changes — `agentAttachCommand(name)` → `agentAttachCommand(name, yolo ?? true)`. Everything else in that handler stays.)

Update the `ipcMain.handle` registrations (~lines 349-350):
```ts
  ipcMain.handle('instance:launch', (_e, id: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', yolo?: boolean) => handlers['instance:launch'](id, name, sessionName, opener, yolo))
  ipcMain.handle('instance:attach', (_e, name: string, opener?: 'terminal' | 'vscode', yolo?: boolean) => handlers['instance:attach'](name, opener, yolo))
```

- [ ] **Step 5: Thread `yolo` through preload + renderer client type**

In `src/preload/index.ts`, update the two forwarders (currently lines ~15-16):
```ts
  instanceLaunch: (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', yolo?: boolean) => ipcRenderer.invoke('instance:launch', definitionId, name, sessionName, opener, yolo),
  instanceAttach: (name: string, opener?: 'terminal' | 'vscode', yolo?: boolean) => ipcRenderer.invoke('instance:attach', name, opener, yolo),
```
(Preserve the exact property names and surrounding formatting; only add the `yolo` param + argument.)

In `src/renderer/ipc/client.ts`, update the `Api` interface entries (lines ~14-15):
```ts
  instanceLaunch(definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', yolo?: boolean): Promise<Result<{ name: string }>>
  instanceAttach(name: string, opener?: 'terminal' | 'vscode', yolo?: boolean): Promise<Result<null>>
```

- [ ] **Step 6: Run test + typecheck**

Run: `npm test -- launch.test && npm run typecheck`
Expected: launch tests PASS; typecheck clean (Task 1's caller errors are now resolved).

- [ ] **Step 7: Commit**

```bash
git add src/main/launch.ts src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/launch.test.ts
git commit -m "feat(launch): carry yolo through launchDefinition + launch/attach IPC"
```

---

### Task 3: UI — Yolo checkbox in the three entry points + wiring + i18n

**Files:**
- Modify: `src/renderer/components/LaunchDialog.tsx`
- Modify: `src/renderer/components/OpenWithDialog.tsx`
- Modify: `src/renderer/screens/detail/TerminalsTab.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/de.ts`
- Test: `tests/renderer/App.launch.test.tsx`
- Test: `tests/renderer/components/LaunchDialog.test.tsx` (create)

**Interfaces:**
- Consumes: `api.instanceLaunch(..., yolo)`, `api.instanceAttach(name, opener, yolo)` (Task 2).
- Callback shapes become: `LaunchDialog.onLaunch(sessionName, opener, yolo)`; `OpenWithDialog.onChoose(opener, yolo)`; `TerminalsTab.onAttach(name, opener, yolo)`; App `onAttach(name, opener?, yolo?)`.

- [ ] **Step 1: Add i18n keys (English)**

In `src/renderer/i18n/en.ts`, inside the `launch` block (near `openWith`/`openTerminal`), add:
```ts
    yoloLabel: 'Yolo mode',
    yoloHint: 'The agent skips permission prompts and auto-approves actions. The sandbox is the safety boundary. Uncheck to be asked before each action.',
```

- [ ] **Step 2: Add i18n keys (German)**

In `src/renderer/i18n/de.ts`, the same `launch` block:
```ts
    yoloLabel: 'Yolo-Modus',
    yoloHint: 'Der Agent überspringt Berechtigungsabfragen und genehmigt Aktionen automatisch. Die Sandbox ist die Sicherheitsgrenze. Deaktivieren, um vor jeder Aktion gefragt zu werden.',
```

- [ ] **Step 3: Write the failing UI tests**

Create `tests/renderer/components/LaunchDialog.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LaunchDialog } from '../../../src/renderer/components/LaunchDialog'

const def = { id: 'd1', name: 'My Project', description: '', baseImage: '', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' } as never

describe('LaunchDialog yolo toggle', () => {
  it('defaults Yolo ON and passes yolo=true on launch', () => {
    const onLaunch = vi.fn()
    render(<LaunchDialog definition={def} hasVSCode={false} cloneMode={false} onLaunch={onLaunch} onCancel={vi.fn()} />)
    const box = screen.getByRole('checkbox', { name: /yolo/i })
    expect(box).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /launch/i }))
    expect(onLaunch).toHaveBeenCalledWith('', 'terminal', true)
  })
  it('passes yolo=false when unchecked', () => {
    const onLaunch = vi.fn()
    render(<LaunchDialog definition={def} hasVSCode={false} cloneMode={false} onLaunch={onLaunch} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /yolo/i }))
    fireEvent.click(screen.getByRole('button', { name: /launch/i }))
    expect(onLaunch).toHaveBeenCalledWith('', 'terminal', false)
  })
})
```

In `tests/renderer/App.launch.test.tsx`, the existing assertion (`expect(instanceLaunch).toHaveBeenCalledWith('d1', undefined, …)`) will gain a trailing `yolo` argument. Update that expectation to include the new final `true` argument (default ON), and update the mock api wiring at the top (lines ~22-23) so `instanceLaunch`/`instanceAttach` forward the extra `yolo` param:
```ts
  instanceLaunch: (id: string, name?: string, session?: string, opener?: string, yolo?: boolean) => instanceLaunch(id, name, session, opener, yolo),
  instanceAttach: (n: string, opener?: string, yolo?: boolean) => instanceAttach(n, opener, yolo),
```
and the launch-flow assertion:
```ts
    await waitFor(() => expect(instanceLaunch).toHaveBeenCalledWith('d1', undefined, /* session */ expect.anything(), /* opener */ expect.anything(), true))
```
(Match the existing test's exact session/opener expectations; only add the trailing `true`.)

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- LaunchDialog App.launch`
Expected: FAIL — no Yolo checkbox; `onLaunch` called with 2 args.

- [ ] **Step 5: Add the checkbox to `LaunchDialog`**

In `src/renderer/components/LaunchDialog.tsx`:
- Widen the prop: `onLaunch: (sessionName: string, opener: 'terminal' | 'vscode', yolo: boolean) => void`.
- Add state: `const [yolo, setYolo] = useState(true)`.
- `submit()` → `onLaunch(sessionName.trim(), opener, yolo)`.
- Render, just below the opener radiogroup block (after the `{opener === 'vscode' && cloneMode && …}` line):
```tsx
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 'var(--space-4)' }}>
          <input type="checkbox" aria-label="Yolo mode" checked={yolo} onChange={(e) => setYolo(e.target.checked)} />
          {t('launch.yoloLabel')}
          <span className="info-dot" tabIndex={0} role="img" aria-label={t('launch.yoloHint')} title={t('launch.yoloHint')}>ⓘ</span>
        </label>
```
(`.info-dot` CSS already exists from the network-tooltip work.)

- [ ] **Step 6: Add the checkbox to `OpenWithDialog`**

In `src/renderer/components/OpenWithDialog.tsx`:
- `import { useState } from 'react'`.
- Widen the prop: `onChoose: (opener: 'terminal' | 'vscode', yolo: boolean) => void`.
- Add `const [yolo, setYolo] = useState(true)`.
- Change the two buttons to pass `yolo`: `onClick={() => onChoose('terminal', yolo)}` and `onClick={() => onChoose('vscode', yolo)}`.
- Add a checkbox row above `modal-actions` (inside `.modal`, before the actions div):
```tsx
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 'var(--space-3)' }}>
          <input type="checkbox" aria-label="Yolo mode" checked={yolo} onChange={(e) => setYolo(e.target.checked)} />
          {t('launch.yoloLabel')}
          <span className="info-dot" tabIndex={0} role="img" aria-label={t('launch.yoloHint')} title={t('launch.yoloHint')}>ⓘ</span>
        </label>
```

- [ ] **Step 7: Add the checkbox to `TerminalsTab`**

In `src/renderer/screens/detail/TerminalsTab.tsx`:
- Widen the prop: `onAttach: (name: string, opener: 'terminal' | 'vscode', yolo: boolean) => void`.
- Add `const [yolo, setYolo] = useState(true)` (ensure `useState` is imported).
- Change the two attach buttons: `onClick={() => onAttach(instance.name, 'terminal', yolo)}` and `onClick={() => onAttach(instance.name, 'vscode', yolo)}`.
- Add a checkbox just above the button row (before the `<div style={{ display: 'flex', gap: … }}>` that holds the buttons):
```tsx
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 'var(--space-2)' }}>
            <input type="checkbox" aria-label="Yolo mode" checked={yolo} onChange={(e) => setYolo(e.target.checked)} />
            {t('launch.yoloLabel')}
            <span className="info-dot" tabIndex={0} role="img" aria-label={t('launch.yoloHint')} title={t('launch.yoloHint')}>ⓘ</span>
          </label>
```

- [ ] **Step 8: Wire `yolo` through `App.tsx`**

In `src/renderer/App.tsx`:
- `submitLaunch` signature → `(definition: Definition, sessionName: string, opener: 'terminal' | 'vscode', yolo: boolean)`, and the call → `api.instanceLaunch(definition.id, undefined, sessionName, opener, yolo)`.
- `onAttach` signature → `(name: string, opener?: 'terminal' | 'vscode', yolo?: boolean)`; when `opener` is present → `void runAction(api.instanceAttach(name, opener, yolo ?? true))`; else `setAttachFor(name)` (unchanged).
- `LaunchDialog` usage → `onLaunch={(session, opener, yolo) => void submitLaunch(launchFor, session, opener, yolo)}`.
- `OpenWithDialog` usage → `onChoose={(opener, yolo) => { const n = attachFor; setAttachFor(null); void runAction(api.instanceAttach(n, opener, yolo)) }}`.
- `TerminalsTab` receives `onAttach` from `InstanceDetail`; verify `InstanceDetail`'s `onAttach` prop type also widens to `(name, opener, yolo)` and forwards to App's `onAttach`. (Update `src/renderer/screens/InstanceDetail.tsx:34` signature `onAttach: (name: string, opener: 'terminal' | 'vscode', yolo: boolean) => void` and pass through.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -- LaunchDialog App.launch`
Expected: PASS.

- [ ] **Step 10: Typecheck + full suite + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all tests pass, build succeeds.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/components/LaunchDialog.tsx src/renderer/components/OpenWithDialog.tsx src/renderer/screens/detail/TerminalsTab.tsx src/renderer/screens/InstanceDetail.tsx src/renderer/App.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/components/LaunchDialog.test.tsx tests/renderer/App.launch.test.tsx
git commit -m "feat(launch): Yolo-mode checkbox on launch + attach entry points"
```

---

## Self-Review

- **Spec coverage:** Task 1 = flag mechanism (`yoloAgentArgs`, additive OFF) + builders; Task 2 = threading through launchDefinition/IPC/preload/client; Task 3 = the three UI entry points (LaunchDialog, OpenWithDialog, TerminalsTab) + App wiring + i18n + tooltip. `rebuild` untouched. Live sanity check is documented in the spec (manual, user).
- **Placeholder scan:** none — concrete code/commands throughout.
- **Type consistency:** `yolo: boolean` optional-default-true across builders/launchDefinition; callback shapes updated consistently (`onLaunch`/`onChoose`/`onAttach` all gain the trailing `yolo`); IPC `Handlers` type, `ipcMain.handle`, preload, and renderer `Api` all add the same optional `yolo?`.
- **Behavior preservation:** ON appends nothing → existing translate/launch assertions unchanged; only the new OFF cases and the App.launch expectation (trailing `true`) are adjusted.
- Out of scope (per spec): persisting the choice, rebuild toggle, finer permission modes.
