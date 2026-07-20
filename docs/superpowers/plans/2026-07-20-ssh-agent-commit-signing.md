# SSH Agent Forwarding & Commit Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "SSH Agent" tab to the Credentials step with two per-definition toggles — Forward SSH Agent (real opt-out) and Automatic Commit Signing (inline `sbx exec` git config) — persisted and applied at launch.

**Architecture:** A `SshConfig` on `DefinitionSpec` (optional, always populated by `toSpec`/DB with `{forwardAgent:true, commitSigning:false}` default), draft flags + SSH tab, a v5→v6 DB migration, launch-command effects in `translate.ts`, an `ssh:detect` IPC, and Review/Detail display.

**Tech Stack:** Electron (main/preload/renderer), electron-vite, React 18 + TS strict, better-sqlite3, Vitest + @testing-library/react. Only `SbxAdapter` spawns `sbx`; only `terminal.ts` owns osascript.

## Global Constraints

- **Run tests with `npm test`** (pretest hook flips the better-sqlite3 ABI); never bare `npx vitest`.
- **SSH agent forwarding is automatic** when `SSH_AUTH_SOCK` is set — there is no `sbx` flag. Opt-out = `unset SSH_AUTH_SOCK; ` prepended to the launch command. Keys never leave the host.
- **Invariant:** `commitSigning` is `true` only when `forwardAgent` is `true`. Enforced in the wizard AND in `toSpec` (defensive).
- **Commit signing commands (verbatim, run in-sandbox):** `git config --global gpg.format ssh` and `git config --global user.signingkey "key::$(ssh-add -L | head -n 1)"`. The `$( )` must stay single-quoted so it executes inside the sandbox, not on the host.
- **`ssh` is optional on `DefinitionSpec`** (`ssh?: SshConfig`) to avoid churning every existing `DefinitionSpec` test fixture; consumers use `spec.ssh ?? DEFAULT_SSH`. Runtime behavior is identical (always populated).
- **i18n parity:** every new key in BOTH `en.ts` and `de.ts` (the `Dict` type enforces it).
- Branch: `phase-9-ssh-agent` (already created off `main`).

---

### Task 1: `SshConfig` type + draft flags + toSpec/draftFromSpec

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/wizard/draft.ts`
- Test: `tests/renderer/wizard/draft-ssh.test.ts` (new)

**Interfaces:**
- Produces: `SshConfig { forwardAgent: boolean; commitSigning: boolean }`, `DEFAULT_SSH`, `DefinitionSpec.ssh?: SshConfig`. Draft `sshForwardAgent`/`sshCommitSigning` + actions `setSshForward`/`setSshCommitSigning`.
- Consumed by: Tasks 2 (DB), 3 (launch), 5 (SSH tab), 6 (review).

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/wizard/draft-ssh.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { draftReducer, initialDraft, toSpec, draftFromSpec } from '../../../src/renderer/wizard/draft'

const base = { ...initialDraft, workspace: '/p', name: 'p' }

describe('draft ssh', () => {
  it('defaults to forward on, signing off', () => {
    expect(base.sshForwardAgent).toBe(true)
    expect(base.sshCommitSigning).toBe(false)
    const spec = toSpec(base, 'id1', 't')
    expect(spec.ssh).toEqual({ forwardAgent: true, commitSigning: false })
  })
  it('sets forward and signing flags', () => {
    let d = draftReducer(base, { type: 'setSshCommitSigning', value: true })
    expect(d.sshCommitSigning).toBe(true)
    d = draftReducer(d, { type: 'setSshForward', value: false })
    expect(d.sshForwardAgent).toBe(false)
  })
  it('turning forward off forces signing off in the reducer', () => {
    let d = draftReducer(base, { type: 'setSshCommitSigning', value: true })
    d = draftReducer(d, { type: 'setSshForward', value: false })
    expect(d.sshCommitSigning).toBe(false)
  })
  it('toSpec never emits signing:true when forward is off (defensive)', () => {
    const d = { ...base, sshForwardAgent: false, sshCommitSigning: true }
    expect(toSpec(d, 'id1', 't').ssh).toEqual({ forwardAgent: false, commitSigning: false })
  })
  it('round-trips through draftFromSpec', () => {
    const spec = toSpec({ ...base, sshCommitSigning: true }, 'id1', 't')
    const d2 = draftFromSpec(spec)
    expect(d2.sshForwardAgent).toBe(true)
    expect(d2.sshCommitSigning).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- draft-ssh`
Expected: FAIL — `sshForwardAgent` undefined / actions missing.

- [ ] **Step 3: Add types to `@shared/types`**

In `src/shared/types.ts`, near `CredentialStore`:

```ts
export interface SshConfig { forwardAgent: boolean; commitSigning: boolean }
export const DEFAULT_SSH: SshConfig = { forwardAgent: true, commitSigning: false }
```

Add to `DefinitionSpec`:

```ts
  ssh?: SshConfig
```

(A `const` in a `.d`-style shared types file is fine — types.ts is a regular module.)

- [ ] **Step 4: Extend the draft**

In `src/renderer/wizard/draft.ts`:
- Add to `Draft`: `sshForwardAgent: boolean` and `sshCommitSigning: boolean`.
- Add to `initialDraft`: `sshForwardAgent: true, sshCommitSigning: false`.
- Add actions to `DraftAction`:
  ```ts
  | { type: 'setSshForward'; value: boolean }
  | { type: 'setSshCommitSigning'; value: boolean }
  ```
- Add reducer cases:
  ```ts
  case 'setSshForward': return { ...d, sshForwardAgent: a.value, sshCommitSigning: a.value ? d.sshCommitSigning : false }
  case 'setSshCommitSigning': return { ...d, sshCommitSigning: a.value }
  ```
- In `toSpec`, add to the returned object:
  ```ts
  ssh: { forwardAgent: d.sshForwardAgent, commitSigning: d.sshForwardAgent && d.sshCommitSigning },
  ```
- In `draftFromSpec`, add to the returned object (import `DEFAULT_SSH` from `@shared/types`):
  ```ts
  sshForwardAgent: (spec.ssh ?? DEFAULT_SSH).forwardAgent,
  sshCommitSigning: (spec.ssh ?? DEFAULT_SSH).commitSigning,
  ```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- draft-ssh draft-creds`
Expected: PASS (draft-creds still green).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/wizard/draft.ts tests/renderer/wizard/draft-ssh.test.ts
git commit -m "feat(ssh): SshConfig type + draft flags with forward⇒signing invariant"
```

---

### Task 2: Persist `ssh` on the definition (DB v5→v6)

**Files:**
- Modify: `src/main/store/db.ts`
- Test: `tests/main/store/db-ssh.test.ts` (new)

**Interfaces:**
- Consumes: `DefinitionSpec.ssh`, `DEFAULT_SSH`.
- Produces: `insertDefinitionSpec`/`updateDefinitionSpec` persist `ssh`; `getDefinitionSpec` returns it (defaulting when columns absent).

- [ ] **Step 1: Write the failing test**

Create `tests/main/store/db-ssh.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '../../../src/main/store/db'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(id: string, ssh?: DefinitionSpec['ssh']): DefinitionSpec {
  return {
    definition: { id, name: 'Proj', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: 't' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains: [], ports: [], hostServices: [], credentials: [], ssh
  }
}

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('ssh persistence', () => {
  it('persists and reloads ssh flags', () => {
    store.insertDefinitionSpec(spec('d1', { forwardAgent: false, commitSigning: false }))
    expect(store.getDefinitionSpec('d1')?.ssh).toEqual({ forwardAgent: false, commitSigning: false })
    store.insertDefinitionSpec(spec('d2', { forwardAgent: true, commitSigning: true }))
    expect(store.getDefinitionSpec('d2')?.ssh).toEqual({ forwardAgent: true, commitSigning: true })
  })
  it('defaults ssh (forward on, signing off) when not provided', () => {
    store.insertDefinitionSpec(spec('d3'))
    expect(store.getDefinitionSpec('d3')?.ssh).toEqual({ forwardAgent: true, commitSigning: false })
  })
  it('updateDefinitionSpec persists changed ssh flags', () => {
    store.insertDefinitionSpec(spec('d4', { forwardAgent: true, commitSigning: true }))
    store.updateDefinitionSpec(spec('d4', { forwardAgent: false, commitSigning: false }))
    expect(store.getDefinitionSpec('d4')?.ssh).toEqual({ forwardAgent: false, commitSigning: false })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- db-ssh`
Expected: FAIL — `ssh` is undefined on the reloaded spec.

- [ ] **Step 3: Schema + migration**

In `src/main/store/db.ts`:
- In the `definition` CREATE TABLE, add two columns:
  ```
  ssh_forward_agent INTEGER NOT NULL DEFAULT 1,
  ssh_commit_signing INTEGER NOT NULL DEFAULT 0
  ```
- Bump `PRAGMA user_version = 6;`.
- Add a migration after the credential_ref one (mirror its `cols.includes` style):
  ```ts
  const defCols = (db.prepare(`PRAGMA table_info(definition)`).all() as { name: string }[]).map((c) => c.name)
  if (!defCols.includes('ssh_forward_agent')) {
    db.exec(`ALTER TABLE definition ADD COLUMN ssh_forward_agent INTEGER NOT NULL DEFAULT 1;`)
    db.exec(`ALTER TABLE definition ADD COLUMN ssh_commit_signing INTEGER NOT NULL DEFAULT 0;`)
  }
  ```

- [ ] **Step 4: Write ssh in insert/update**

`insertDefinitionSpec` and `updateDefinitionSpec` write via `s.definition` named params, but `ssh` lives on `s.ssh`. Change both definition writes to explicit columns/values:

In `insertDefinitionSpec`:
```ts
db.prepare(
  `INSERT INTO definition (id, name, description, base_image, tier, created_at, ssh_forward_agent, ssh_commit_signing)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
).run(s.definition.id, s.definition.name, s.definition.description, s.definition.baseImage, s.definition.tier, s.definition.createdAt,
      (s.ssh ?? DEFAULT_SSH).forwardAgent ? 1 : 0, ((s.ssh ?? DEFAULT_SSH).forwardAgent && (s.ssh ?? DEFAULT_SSH).commitSigning) ? 1 : 0)
```

In `updateDefinitionSpec`, extend the UPDATE:
```ts
const res = db.prepare(
  `UPDATE definition SET name = ?, description = ?, base_image = ?, tier = ?, ssh_forward_agent = ?, ssh_commit_signing = ? WHERE id = ?`
).run(s.definition.name, s.definition.description, s.definition.baseImage, s.definition.tier,
      (s.ssh ?? DEFAULT_SSH).forwardAgent ? 1 : 0, ((s.ssh ?? DEFAULT_SSH).forwardAgent && (s.ssh ?? DEFAULT_SSH).commitSigning) ? 1 : 0,
      s.definition.id)
```

Import `DEFAULT_SSH` from `@shared/types` at the top of db.ts.

(Leave the standalone `insertDefinition(d: Definition)` untouched — the new columns have defaults, so Definition-only inserts still work.)

- [ ] **Step 5: Read ssh in getDefinitionSpec**

Add an `ssh` SELECT and include it in the returned spec. After the `def` fetch:
```ts
const sshRow = db.prepare(`SELECT ssh_forward_agent AS fwd, ssh_commit_signing AS sign FROM definition WHERE id = ?`).get(id) as { fwd: number; sign: number } | undefined
const ssh = { forwardAgent: (sshRow?.fwd ?? 1) === 1, commitSigning: (sshRow?.sign ?? 0) === 1 }
```
Add `ssh` to the final `return { definition: def, mounts, domains, ports, hostServices, credentials, ssh }`.

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- db-ssh db-creds db-ports`
Expected: PASS (existing DB tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/main/store/db.ts tests/main/store/db-ssh.test.ts
git commit -m "feat(ssh): persist ssh forward/commit-signing on the definition (DB v5→v6)"
```

---

### Task 3: Launch-command SSH effects

**Files:**
- Modify: `src/main/sbx/translate.ts`
- Test: `tests/main/sbx/translate-ssh.test.ts` (new)

**Interfaces:**
- Consumes: `spec.ssh`, `DEFAULT_SSH`.
- Produces: `commitSigningExecCommand(name: string): string`; `launchCommand` honors `spec.ssh`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/sbx/translate-ssh.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { launchCommand, commitSigningExecCommand } from '../../../src/main/sbx/translate'
import type { DefinitionSpec } from '../../../src/shared/types'

const base: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: []
}

describe('launchCommand ssh', () => {
  it('default (forward on, no signing) does not touch SSH_AUTH_SOCK or run git config', () => {
    const cmd = launchCommand({ ...base, ssh: { forwardAgent: true, commitSigning: false } }, 'my-project')
    expect(cmd).not.toContain('unset SSH_AUTH_SOCK')
    expect(cmd).not.toContain('git config')
  })
  it('forward off prepends unset SSH_AUTH_SOCK', () => {
    const cmd = launchCommand({ ...base, ssh: { forwardAgent: false, commitSigning: false } }, 'my-project')
    expect(cmd.startsWith('unset SSH_AUTH_SOCK ; ')).toBe(true)
  })
  it('commit signing inserts the git-config exec right after create', () => {
    const cmd = launchCommand({ ...base, ssh: { forwardAgent: true, commitSigning: true } }, 'my-project')
    expect(cmd).toContain(commitSigningExecCommand('my-project'))
    const createIdx = cmd.indexOf('sbx create')
    const execIdx = cmd.indexOf('sbx exec my-project')
    const runIdx = cmd.indexOf('sbx run')
    expect(createIdx).toBeLessThan(execIdx)
    expect(execIdx).toBeLessThan(runIdx)
  })
  it('commitSigningExecCommand emits the exact documented git config', () => {
    expect(commitSigningExecCommand('my-project')).toBe(
      `sbx exec my-project bash -lc 'git config --global gpg.format ssh && git config --global user.signingkey "key::$(ssh-add -L | head -n 1)"'`
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- translate-ssh`
Expected: FAIL — `commitSigningExecCommand` missing; ssh not honored.

- [ ] **Step 3: Implement**

In `src/main/sbx/translate.ts`, add (import `DEFAULT_SSH` from `@shared/types`):

```ts
// SSH-based commit signing setup, run INSIDE the sandbox against the forwarded agent.
// The body is single-quoted so `$( )` executes in the sandbox, not on the host.
export function commitSigningExecCommand(name: string): string {
  return `sbx exec ${name} bash -lc 'git config --global gpg.format ssh && git config --global user.signingkey "key::$(ssh-add -L | head -n 1)"'`
}
```

In `launchCommand`, after the `steps` array is built and before `return steps.join(' && ')`, splice in the signing step after create and apply the forward-off prefix:

```ts
const ssh = spec.ssh ?? DEFAULT_SSH
if (ssh.forwardAgent && ssh.commitSigning) {
  steps.splice(1, 0, commitSigningExecCommand(name)) // right after `sbx create …`
}
const chain = steps.join(' && ')
return ssh.forwardAgent ? chain : `unset SSH_AUTH_SOCK ; ${chain}`
```

(`name` is already in scope in `launchCommand`. `commitSigningExecCommand` output is a full command string, matching how `steps` holds command strings.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- translate-ssh translate-login`
Expected: PASS (login command test unaffected).

- [ ] **Step 5: Full launch regression**

Run: `npm test -- launch`
Expected: PASS — existing launch.test.ts specs have no `ssh`, so `DEFAULT_SSH` (forward on, signing off) applies → their expected command strings are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/main/sbx/translate.ts tests/main/sbx/translate-ssh.test.ts
git commit -m "feat(ssh): launchCommand honors forward opt-out + inline commit-signing exec"
```

---

### Task 4: SSH detection (`sshAuthSockPresent` + `ssh:detect` IPC)

**Files:**
- Create: `src/main/ssh/detect.ts`
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/ipc/client.ts`
- Test: `tests/main/ssh/detect.test.ts` (new), addition to `tests/main/ipc.test.ts`

**Interfaces:**
- Produces: `sshAuthSockPresent(env): boolean`; IPC `ssh:detect() → Result<{ present: boolean }>`; client `sshDetect()`.
- Consumed by: Task 5 (wizard).

- [ ] **Step 1: Write the failing tests**

Create `tests/main/ssh/detect.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sshAuthSockPresent } from '../../../src/main/ssh/detect'

describe('sshAuthSockPresent', () => {
  it('true when SSH_AUTH_SOCK is a non-empty string', () => {
    expect(sshAuthSockPresent({ SSH_AUTH_SOCK: '/tmp/agent.sock' })).toBe(true)
  })
  it('false when unset or empty', () => {
    expect(sshAuthSockPresent({})).toBe(false)
    expect(sshAuthSockPresent({ SSH_AUTH_SOCK: '' })).toBe(false)
    expect(sshAuthSockPresent({ SSH_AUTH_SOCK: undefined })).toBe(false)
  })
})
```

In `tests/main/ipc.test.ts`, add:
```ts
it('ssh:detect reports whether SSH_AUTH_SOCK is present', async () => {
  const h = buildHandlers({ adapter, store: openStore(":memory:"), probes, openTerminal: () => {}, readLoginEnv: () => ({ SSH_AUTH_SOCK: '/tmp/s.sock' }) })
  const r = await h['ssh:detect']()
  expect(r.ok && r.data.present).toBe(true)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- ssh/detect tests/main/ipc.test.ts`
Expected: FAIL — module + handler missing.

- [ ] **Step 3: Implement the pure helper**

Create `src/main/ssh/detect.ts`:

```ts
/** True when the host login env has a usable SSH agent socket. */
export function sshAuthSockPresent(env: Record<string, string | undefined>): boolean {
  return typeof env.SSH_AUTH_SOCK === 'string' && env.SSH_AUTH_SOCK.length > 0
}
```

- [ ] **Step 4: Add the IPC handler**

In `src/main/ipc.ts`:
- Import: `import { sshAuthSockPresent } from './ssh/detect'`.
- Add to the return-type object: `'ssh:detect': () => Promise<Result<{ present: boolean }>>`.
- Add the handler: `'ssh:detect': () => wrap(async () => ({ present: sshAuthSockPresent(deps.readLoginEnv?.() ?? {}) })),`
- Register: `ipcMain.handle('ssh:detect', () => handlers['ssh:detect']())`.

- [ ] **Step 5: preload + client**

Preload `api`: `sshDetect: () => ipcRenderer.invoke('ssh:detect'),`.
Client interface: `sshDetect(): Promise<Result<{ present: boolean }>>`.
Client fallback: `sshDetect: async () => ({ ok: true, data: { present: false } }),`.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- ssh/detect tests/main/ipc.test.ts` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/ssh/detect.ts src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ssh/detect.test.ts tests/main/ipc.test.ts
git commit -m "feat(ssh): ssh:detect IPC + sshAuthSockPresent host check"
```

---

### Task 5: SSH Agent tab in the Credentials step + wizard wiring

**Files:**
- Modify: `src/renderer/wizard/CredentialsStep.tsx`
- Modify: `src/renderer/wizard/CreateDefinition.tsx` (pass ssh props + detect on mount)
- Modify: `src/renderer/i18n/en.ts`, `de.ts`
- Test: `tests/renderer/wizard/CredentialsStep.test.tsx` (additions)

**Interfaces:**
- Consumes: draft ssh flags + actions (Task 1); `api.sshDetect` (Task 4).
- `CredentialsStep` new props: `ssh: { forwardAgent: boolean; commitSigning: boolean }`, `onSshChange: (next: { forwardAgent: boolean; commitSigning: boolean }) => void`, `sshDetected: boolean`.

- [ ] **Step 1: Add i18n keys (en + de)**

In `en.ts` `credentials` object, add:
```ts
tabSsh: 'SSH Agent',
sshHint: 'Docker Sandboxes forwards your host SSH agent into the sandbox so Git over SSH and commit signing work without the private key leaving your host.',
sshForward: 'Forward SSH Agent',
sshForwardKeysHint: 'Keys stay on host — the sandbox requests signatures only.',
sshDetected: 'SSH agent detected (SSH_AUTH_SOCK is set)',
sshNotDetected: 'No SSH agent detected on the host',
sshCommitSigning: 'Automatic Commit Signing',
sshCommitSigningHint: 'Configures git config gpg.format ssh and user.signingkey inside the sandbox so git commit -S works.',
sshHowItWorks: 'The host SSH agent socket is forwarded at runtime. Sign git commit -S inside the sandbox — the private key stays on your host. Outbound SSH is subject to the sandbox network policy.'
```
Add the German equivalents to `de.ts` (same keys).

- [ ] **Step 2: Write the failing test**

In `tests/renderer/wizard/CredentialsStep.test.tsx`, extend the `setup` props default with `ssh: { forwardAgent: true, commitSigning: false }, onSshChange: vi.fn(), sshDetected: true` and add:

```ts
it('SSH tab shows detection status and toggles forward/signing', () => {
  const p = setup({ sshDetected: true })
  fireEvent.click(screen.getByRole('tab', { name: 'SSH Agent' }))
  expect(screen.getByText(/ssh agent detected/i)).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Automatic Commit Signing'))
  expect(p.onSshChange).toHaveBeenCalledWith({ forwardAgent: true, commitSigning: true })
})
it('disables commit signing when forward is off', () => {
  setup({ ssh: { forwardAgent: false, commitSigning: false } })
  fireEvent.click(screen.getByRole('tab', { name: 'SSH Agent' }))
  expect(screen.getByLabelText('Automatic Commit Signing')).toBeDisabled()
})
it('turning forward off clears signing', () => {
  const p = setup({ ssh: { forwardAgent: true, commitSigning: true } })
  fireEvent.click(screen.getByRole('tab', { name: 'SSH Agent' }))
  fireEvent.click(screen.getByLabelText('Forward SSH Agent'))
  expect(p.onSshChange).toHaveBeenCalledWith({ forwardAgent: false, commitSigning: false })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- CredentialsStep`
Expected: FAIL — no SSH tab / props.

- [ ] **Step 4: Implement the SSH tab**

In `CredentialsStep.tsx`:
- Extend the props type with `ssh`, `onSshChange`, `sshDetected`.
- Extend the tab state union: `'service' | 'custom' | 'registry' | 'ssh'`.
- Add the tab button after Registry:
  ```tsx
  <button role="tab" aria-selected={tab === 'ssh'} style={credTabStyle(tab === 'ssh')} onClick={() => setTab('ssh')}>{t('credentials.tabSsh')}</button>
  ```
- Add the panel (after the registry panel, before the security note):
  ```tsx
  {tab === 'ssh' && (
    <>
      <p style={hint}>{t('credentials.sshHint')}</p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 'var(--space-3) 0 4px' }}>
        <input type="checkbox" aria-label="Forward SSH Agent" checked={ssh.forwardAgent}
          onChange={(e) => onSshChange({ forwardAgent: e.target.checked, commitSigning: e.target.checked ? ssh.commitSigning : false })} />
        <strong style={{ fontSize: 13 }}>{t('credentials.sshForward')}</strong>
      </label>
      <p style={{ ...hint, margin: '0 0 2px 22px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: sshDetected ? 'var(--success, #3fb950)' : 'var(--text-muted)', display: 'inline-block' }} />
        {sshDetected ? t('credentials.sshDetected') : t('credentials.sshNotDetected')}
      </p>
      <p style={{ ...hint, margin: '0 0 var(--space-3) 22px' }}>{t('credentials.sshForwardKeysHint')}</p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 'var(--space-2) 0 4px' }}>
        <input type="checkbox" aria-label="Automatic Commit Signing" disabled={!ssh.forwardAgent} checked={ssh.commitSigning}
          onChange={(e) => onSshChange({ forwardAgent: ssh.forwardAgent, commitSigning: e.target.checked })} />
        <strong style={{ fontSize: 13, opacity: ssh.forwardAgent ? 1 : 0.5 }}>{t('credentials.sshCommitSigning')}</strong>
      </label>
      <p style={{ ...hint, margin: '0 0 var(--space-3) 22px' }}>{t('credentials.sshCommitSigningHint')}</p>
      <p style={{ ...hint, padding: '10px 12px', background: 'var(--surface-2, rgba(127,127,127,.06))', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>{t('credentials.sshHowItWorks')}</p>
    </>
  )}
  ```

- [ ] **Step 5: Wire into CreateDefinition**

In `CreateDefinition.tsx`:
- Add SSH detection state: `const [sshDetected, setSshDetected] = useState(false)`.
- In the existing env-scan `useEffect` (or a new one keyed on step 4), also call detect:
  ```tsx
  useEffect(() => { let alive = true; void api.sshDetect().then((r) => { if (alive && r.ok) setSshDetected(r.data.present) }); return () => { alive = false } }, [draft.step])
  ```
- Pass to `<CredentialsStep>`:
  ```tsx
  ssh={{ forwardAgent: draft.sshForwardAgent, commitSigning: draft.sshCommitSigning }}
  onSshChange={(next) => { dispatch({ type: 'setSshForward', value: next.forwardAgent }); dispatch({ type: 'setSshCommitSigning', value: next.commitSigning }) }}
  sshDetected={sshDetected}
  ```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- CredentialsStep CreateDefinition` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/wizard/CredentialsStep.tsx src/renderer/wizard/CreateDefinition.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/wizard/CredentialsStep.test.tsx
git commit -m "feat(ssh): SSH Agent tab in Credentials step + detection wiring"
```

---

### Task 6: Review row + Instance Detail display

**Files:**
- Modify: `src/renderer/wizard/CreateDefinition.tsx` (Review row)
- Modify: `src/renderer/screens/detail/TerminalsTab.tsx` (Credentials card line)
- Modify: `src/renderer/i18n/en.ts`, `de.ts`
- Test: additions to `tests/renderer/wizard/CreateDefinition.test.tsx`

**Interfaces:**
- Consumes: `draft.sshForwardAgent`/`sshCommitSigning`; `spec.ssh`.

- [ ] **Step 1: Add i18n keys (en + de)**

In `wizard` group: `reviewSsh: 'SSH Agent'`, `sshForwarded: 'Forwarded'`, `sshOff: 'Off'`, `sshPlusSigning: '+ commit signing'`.
In `detail` group: `sshAgent: 'SSH Agent'`.
Add German equivalents.

- [ ] **Step 2: Write the failing test**

In `tests/renderer/wizard/CreateDefinition.test.tsx`, add a test that reaches the Review step (step 6) — or assert the pure summary. Simplest robust check: add a review-string unit by rendering to step 6 is heavy; instead assert via a small exported helper. Add to `CreateDefinition.tsx` an exported pure `sshSummary(d: { sshForwardAgent: boolean; sshCommitSigning: boolean }, t): string` and test it:

```ts
import { sshSummary } from '../../../src/renderer/wizard/CreateDefinition'
const t = (k: string) => ({ 'wizard.sshForwarded': 'Forwarded', 'wizard.sshOff': 'Off', 'wizard.sshPlusSigning': '+ commit signing' }[k] ?? k)
it('sshSummary reflects forward/off and signing', () => {
  expect(sshSummary({ sshForwardAgent: true, sshCommitSigning: false }, t)).toBe('Forwarded')
  expect(sshSummary({ sshForwardAgent: true, sshCommitSigning: true }, t)).toBe('Forwarded + commit signing')
  expect(sshSummary({ sshForwardAgent: false, sshCommitSigning: false }, t)).toBe('Off')
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- CreateDefinition`
Expected: FAIL — `sshSummary` not exported.

- [ ] **Step 4: Implement**

In `CreateDefinition.tsx`, add an exported helper near `credentialsSummary`:
```ts
export function sshSummary(d: { sshForwardAgent: boolean; sshCommitSigning: boolean }, t: (k: string) => string): string {
  if (!d.sshForwardAgent) return t('wizard.sshOff')
  return d.sshCommitSigning ? `${t('wizard.sshForwarded')} ${t('wizard.sshPlusSigning')}` : t('wizard.sshForwarded')
}
```
Add a Review row after the credentials row:
```tsx
<tr><td>{t('wizard.reviewSsh')}</td><td>{sshSummary(draft, t)}</td></tr>
```

In `TerminalsTab.tsx`, in the Credentials card, add a line (reads `spec.ssh`, defaulting):
```tsx
{spec && (
  <div className="cred-type-group">
    <div className="cred-type-label">{t('detail.sshAgent')}</div>
    <div className="secret-row" style={{ background: 'transparent', border: 'none', padding: '2px 0' }}>
      <div className="secret-info"><span className="secret-value">
        {(spec.ssh?.forwardAgent ?? true) ? t('wizard.sshForwarded') : t('wizard.sshOff')}{(spec.ssh?.commitSigning) ? ` · ${t('credentials.sshCommitSigning')}` : ''}
      </span></div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Run tests + typecheck + build**

Run: `npm test -- CreateDefinition` then `npm run typecheck` then `npm run build`
Expected: PASS; typecheck clean; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/wizard/CreateDefinition.tsx src/renderer/screens/detail/TerminalsTab.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/wizard/CreateDefinition.test.tsx
git commit -m "feat(ssh): Review row + instance-detail SSH agent status line"
```

---

### Task 7: Full verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Typecheck** — `npm run typecheck` (clean).
- [ ] **Step 2: Full suite** — `npm test` (all green).
- [ ] **Step 3: Build** — `npm run build` (succeeds).
- [ ] **Step 4: Optional manual spike** — in a scratch sandbox confirm `sbx exec <name> bash -lc 'ssh-add -L'` sees the forwarded key, and `unset SSH_AUTH_SOCK; sbx run …` leaves `SSH_AUTH_SOCK` unset in-sandbox. Clean up the sandbox after.
- [ ] **Step 5: Finish** — announce and use `superpowers:finishing-a-development-branch`; verify tests; present merge/PR options.

---

## Self-Review

**Spec coverage:** A (data model) → Tasks 1, 2. B (SSH tab) → Task 5. C (launch) → Task 3. D (detection IPC) → Task 4. E (Review + Detail) → Task 6. Testing → each task + Task 7. All covered.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `SshConfig`/`DEFAULT_SSH` defined once in `@shared/types` and imported by draft, db, translate. `spec.ssh` is optional everywhere and always read via `?? DEFAULT_SSH`. `commitSigningExecCommand(name)` signature matches Task 3 impl + test. `CredentialsStep` new props (`ssh`, `onSshChange`, `sshDetected`) match Task 5 impl + wiring. `sshSummary` and `sshAuthSockPresent` names match across tasks. The forward⇒signing invariant is enforced in the reducer (Task 1), `toSpec` (Task 1), DB write (Task 2), and the UI (Task 5).
