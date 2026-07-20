# Claude Code OAuth Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user sign in to Claude Code with their own Anthropic account via a host-side OAuth flow (`/login`) — surfaced as a one-time Settings sign-in and a non-blocking launch-time nudge when no credential is configured.

**Architecture:** A pure auth-detection parser over `sbx secret ls -g`, a generated OAuth login kit + always-on Claude domain baseline in kit generation, a login command that opens an ephemeral self-cleaning Claude terminal, three `auth:*` IPC handlers plus a launch precheck, and renderer pieces (Settings → Accounts, a launch nudge dialog).

**Tech Stack:** Electron (main/preload/renderer), electron-vite, React 18 + TypeScript strict, better-sqlite3, Vitest + @testing-library/react (jsdom). Native Terminal.app via osascript (behind `terminal.ts`); only `SbxAdapter` spawns `sbx`.

## Global Constraints

- **Scope: Anthropic / Claude Code only.** The app hardcodes the `claude` agent (`AGENT_KEYWORD` in `src/main/sbx/translate.ts`). No other agents in this feature.
- **Run tests with `npm test`** (the pretest hook flips the better-sqlite3 ABI); never bare `npx vitest`.
- **No secret on the command line, ever.** OAuth uses the interactive `/login`; the app never handles the token. The real token stays host-side (`sbx secret ls -g` → `(global) service anthropic (oauth configured)`); the VM sees only `sk-ant-…-proxy-managed` sentinels.
- **OAuth requires these domains allowlisted or it 403s:** `api.anthropic.com`, `platform.claude.com`, `console.anthropic.com`, `claude.com`, `downloads.claude.ai` (+ `claude.ai`, `mcp-proxy.anthropic.com` for normal operation).
- **i18n parity:** every new `credentials`/`settings`/`auth` key must exist in BOTH `src/renderer/i18n/en.ts` and `de.ts` (the `Dict` type enforces it via typecheck).
- **Single choke points:** only `SbxAdapter` spawns `sbx`; only `terminal.ts` owns osascript.
- Branch: `phase-8-claude-oauth` (already created off `main`).

---

### Task 1: Claude domain baseline in kit generation

Ensures every Claude sandbox can reach Anthropic (inference + OAuth) regardless of whether a credential is configured — the prerequisite that stops the in-session `/login` from 403ing.

**Files:**
- Modify: `src/shared/services.ts` (anthropic domains)
- Modify: `src/main/kit/generate.ts` (always include Claude baseline)
- Test: `tests/main/kit/generate.test.ts`, `tests/shared/services.test.ts`

**Interfaces:**
- Consumes: `KNOWN_SERVICES`, `buildKitSpec(spec)` (existing).
- Produces: `CLAUDE_AGENT_DOMAINS: string[]` exported from `generate.ts`; `allowedDomains` always contains the Claude baseline for `locked`/`balanced` tiers.

- [ ] **Step 1: Write the failing test (services domains)**

In `tests/shared/services.test.ts`, add:

```ts
it('anthropic service includes the OAuth token-exchange domains', () => {
  const a = KNOWN_SERVICES.find((s) => s.id === 'anthropic')!
  expect(a.domains).toEqual(expect.arrayContaining(['api.anthropic.com', 'platform.claude.com', 'claude.com']))
})
```

(Ensure `KNOWN_SERVICES` is imported at the top of the test file.)

- [ ] **Step 2: Write the failing test (kit baseline)**

In `tests/main/kit/generate.test.ts`, add:

```ts
it('always allowlists the Claude agent baseline even with no credential (locked tier)', () => {
  const k = buildKitSpec(spec([], 'locked', []))
  for (const d of ['api.anthropic.com', 'platform.claude.com', 'console.anthropic.com', 'claude.com', 'downloads.claude.ai', 'claude.ai', 'mcp-proxy.anthropic.com']) {
    expect(k.specYaml).toContain(d)
  }
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- services generate`
Expected: FAIL — anthropic missing `platform.claude.com`/`claude.com`; kit missing baseline.

- [ ] **Step 4: Add the domains to KNOWN_SERVICES**

In `src/shared/services.ts`, update the anthropic entry's `domains` to:

```ts
{ id: 'anthropic', label: 'Anthropic', envVars: ['ANTHROPIC_API_KEY'], domains: ['api.anthropic.com', 'console.anthropic.com', 'claude.ai', 'claude.com', 'platform.claude.com', 'mcp-proxy.anthropic.com'] },
```

- [ ] **Step 5: Add the always-on baseline in generate.ts**

In `src/main/kit/generate.ts`, add the exported constant and merge it in `allowedDomains`:

```ts
// The app always launches the `claude` agent, so every sandbox must reach Anthropic
// for inference AND the OAuth /login token exchange — independent of credentials.
export const CLAUDE_AGENT_DOMAINS = [
  'api.anthropic.com', 'console.anthropic.com', 'claude.ai',
  'platform.claude.com', 'claude.com', 'downloads.claude.ai', 'mcp-proxy.anthropic.com'
]
```

Then in `allowedDomains(spec)`, change the non-open branch to include the baseline:

```ts
const all = open ? ['**'] : [...tierBase, ...CLAUDE_AGENT_DOMAINS, ...spec.domains, ...svc, ...hostSvc]
```

(Leave the `open` tier `['**']` untouched.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- services generate`
Expected: PASS (all existing generate tests still pass — dedup keeps single entries).

- [ ] **Step 7: Commit**

```bash
git add src/shared/services.ts src/main/kit/generate.ts tests/shared/services.test.ts tests/main/kit/generate.test.ts
git commit -m "feat(kit): always allowlist Claude agent domains (incl. OAuth) so /login works"
```

---

### Task 2: `parseClaudeAuth` detection parser + auth types

The pure heart of detection: turn `sbx secret ls -g` text into a Claude auth state.

**Files:**
- Create: `src/main/auth/status.ts`
- Test: `tests/main/auth/status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ClaudeAuthKind = 'oauth' | 'apikey' | 'none'
  export interface AuthStatus { anthropic: ClaudeAuthKind }
  export function parseClaudeAuth(secretLsGlobalStdout: string): ClaudeAuthKind
  ```
- Consumed by: Task 4 (auth glue), Task 5 (IPC).

- [ ] **Step 1: Write the failing test**

Create `tests/main/auth/status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseClaudeAuth } from '../../../src/main/auth/status'

const OAUTH = `SCOPE      TYPE      NAME        SECRET
(global)   service   anthropic   (oauth configured)`

const APIKEY = `SCOPE      TYPE      NAME        SECRET
(global)   service   anthropic   sk-ant******...******8AAA`

describe('parseClaudeAuth', () => {
  it('detects an OAuth global anthropic row', () => {
    expect(parseClaudeAuth(OAUTH)).toBe('oauth')
  })
  it('detects an API-key global anthropic row', () => {
    expect(parseClaudeAuth(APIKEY)).toBe('apikey')
  })
  it('returns none when there is no anthropic row', () => {
    expect(parseClaudeAuth('No secrets found for scope "(global)".')).toBe('none')
    expect(parseClaudeAuth('')).toBe('none')
  })
  it('ignores an anthropic row from a non-global (sandbox) scope', () => {
    expect(parseClaudeAuth('SCOPE  TYPE  NAME  SECRET\nmy-box  service  anthropic  sk-ant***')).toBe('none')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- auth/status`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `src/main/auth/status.ts`:

```ts
export type ClaudeAuthKind = 'oauth' | 'apikey' | 'none'
export interface AuthStatus { anthropic: ClaudeAuthKind }

/**
 * Parse `sbx secret ls -g` output for the Claude (anthropic) auth state.
 * Verified marker (2026-07-20): a global OAuth login shows
 *   `(global)  service  anthropic  (oauth configured)`
 * while an API key shows a masked value (`sk-ant…`). Only the global scope counts.
 */
export function parseClaudeAuth(secretLsGlobalStdout: string): ClaudeAuthKind {
  for (const line of secretLsGlobalStdout.split('\n')) {
    const cols = line.trim().split(/\s{2,}/) // columns are 2+ space separated
    if (cols.length < 4) continue
    const [scope, , name, secret] = cols
    if (!/\(global\)/.test(scope)) continue
    if (name.trim() !== 'anthropic') continue
    return /oauth/i.test(secret) ? 'oauth' : 'apikey'
  }
  return 'none'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- auth/status`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/auth/status.ts tests/main/auth/status.test.ts
git commit -m "feat(auth): parseClaudeAuth — detect Claude OAuth/apikey/none from sbx secret ls -g"
```

---

### Task 3: Adapter global-secret read + login command + login kit

The `sbx` and command building this feature needs, kept behind the adapter/translate/generate choke points.

**Files:**
- Modify: `src/main/sbx/adapter.ts` (add `listGlobalSecretsRaw`)
- Modify: `src/main/sbx/translate.ts` (add `loginCommand`)
- Modify: `src/main/kit/generate.ts` (add `buildLoginKit`)
- Test: `tests/main/sbx/translate.test.ts` (or a new `translate-login.test.ts`), `tests/main/kit/generate.test.ts`
- Test adapter stubs: `tests/main/ipc.test.ts`, `tests/main/ipc-definitions.test.ts`, `tests/main/reconciler.test.ts`, `tests/main/launch.test.ts`

**Interfaces:**
- Produces:
  - `SbxAdapter.listGlobalSecretsRaw(): Promise<string>` — stdout of `sbx secret ls -g`.
  - `loginCommand(workdir: string, name: string, kitDir: string): string` — the self-cleaning terminal chain.
  - `buildLoginKit(): GeneratedKit` — a mixin kit whose `allowedDomains` is exactly the OAuth set.
- Consumed by: Task 4, Task 5.

- [ ] **Step 1: Write the failing test (loginCommand)**

Create `tests/main/sbx/translate-login.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loginCommand } from '../../../src/main/sbx/translate'

describe('loginCommand', () => {
  it('runs claude in the workdir with the login kit, then removes the ephemeral sandbox', () => {
    const cmd = loginCommand('/tmp/sbx-login', 'sbx-oauth-login', '/tmp/sbx-login/.kit')
    expect(cmd).toContain('sbx run claude /tmp/sbx-login --name sbx-oauth-login --kit /tmp/sbx-login/.kit')
    expect(cmd).toMatch(/sbx rm sbx-oauth-login (--force|-f)/)
    expect(cmd).not.toContain('secret') // no credential ever on the command line
  })
})
```

- [ ] **Step 2: Write the failing test (buildLoginKit)**

In `tests/main/kit/generate.test.ts`, add:

```ts
it('buildLoginKit allowlists exactly the OAuth domains', () => {
  const k = buildLoginKit()
  for (const d of ['api.anthropic.com', 'platform.claude.com', 'console.anthropic.com', 'claude.com', 'downloads.claude.ai']) {
    expect(k.specYaml).toContain(d)
  }
  expect(k.secretFiles).toEqual([])
})
```

(Add `buildLoginKit` to the import from `generate`.)

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- translate-login generate`
Expected: FAIL — `loginCommand`/`buildLoginKit` not exported.

- [ ] **Step 4: Implement `listGlobalSecretsRaw` on the adapter**

In `src/main/sbx/adapter.ts`: add to the `SbxAdapter` interface `listGlobalSecretsRaw(): Promise<string>`, implement it near `setSecret`:

```ts
async function listGlobalSecretsRaw(): Promise<string> {
  const res = await runSbx(['secret', 'ls', '-g'])
  return res.stdout
}
```

and add `listGlobalSecretsRaw` to the returned object.

- [ ] **Step 5: Implement `loginCommand` in translate.ts**

In `src/main/sbx/translate.ts` (reuse `shellCommand`/`shellQuote` already there):

```ts
// Ephemeral Claude session for a host-side OAuth `/login`. Chained with `;` so the
// throwaway sandbox is removed after the user exits Claude; the global token persists.
export function loginCommand(workdir: string, name: string, kitDir: string): string {
  const run = shellCommand(['sbx', 'run', 'claude', workdir, '--name', name, '--kit', kitDir])
  const rm = shellCommand(['sbx', 'rm', name, '--force'])
  return `${run} ; ${rm}`
}
```

- [ ] **Step 6: Implement `buildLoginKit` in generate.ts**

In `src/main/kit/generate.ts`, add (reusing the existing YAML assembly / `CLAUDE_AGENT_DOMAINS` where the OAuth subset lives):

```ts
const OAUTH_LOGIN_DOMAINS = ['api.anthropic.com', 'platform.claude.com', 'console.anthropic.com', 'claude.com', 'downloads.claude.ai']

/** Standalone mixin kit for the ephemeral OAuth login sandbox (Settings sign-in). */
export function buildLoginKit(): GeneratedKit {
  const name = 'ai-sandbox-oauth-login'
  const lines = ['schemaVersion: "1"', 'kind: mixin', `name: ${name}`, 'displayName: "OAuth Login"', 'network:', '  allowedDomains:']
  for (const d of OAUTH_LOGIN_DOMAINS) lines.push(`    - ${d}`)
  return { name, specYaml: lines.join('\n') + '\n', secretFiles: [] }
}
```

- [ ] **Step 7: Update adapter test stubs**

In `tests/main/ipc.test.ts`, `tests/main/ipc-definitions.test.ts`, `tests/main/reconciler.test.ts`, add to each adapter mock object:

```ts
listGlobalSecretsRaw: async () => '',
```

In `tests/main/launch.test.ts` the adapter is a partial (`Pick`); no change needed unless typecheck flags it — if it does, add `listGlobalSecretsRaw: async () => ''` to its `adapter` object.

- [ ] **Step 8: Run tests + typecheck**

Run: `npm test -- translate-login generate ipc reconciler` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/main/sbx/adapter.ts src/main/sbx/translate.ts src/main/kit/generate.ts tests/
git commit -m "feat(auth): adapter global-secret read, loginCommand, and OAuth login kit"
```

---

### Task 4: Auth glue — status, sign-out, and the launch-nudge decision

Composes the adapter + parser + store into the operations the IPC layer calls, with a pure, tested gate decision.

**Files:**
- Create: `src/main/auth/manager.ts`
- Test: `tests/main/auth/manager.test.ts`

**Interfaces:**
- Consumes: `parseClaudeAuth`, `AuthStatus`, `ClaudeAuthKind` (Task 2); `SbxAdapter.listGlobalSecretsRaw`, `removeSecret` (Task 3 / existing); `DefinitionSpec`.
- Produces:
  ```ts
  export function claudeAuthStatus(deps: { listGlobalSecretsRaw: () => Promise<string> }): Promise<AuthStatus>
  export function claudeSignOut(deps: { removeSecret: (s: string, o: { global?: boolean }) => Promise<void> }): Promise<void>
  export function hasAnthropicCredential(spec: DefinitionSpec): boolean
  export function needsAuthNudge(status: ClaudeAuthKind, spec: DefinitionSpec): boolean
  ```
- Consumed by: Task 5 (IPC).

- [ ] **Step 1: Write the failing test**

Create `tests/main/auth/manager.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { claudeAuthStatus, claudeSignOut, hasAnthropicCredential, needsAuthNudge } from '../../../src/main/auth/manager'
import type { DefinitionSpec } from '../../../src/shared/types'

const spec = (creds: DefinitionSpec['credentials']): DefinitionSpec => ({
  definition: { id: 'd', name: 'n', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: creds
})

describe('auth manager', () => {
  it('claudeAuthStatus maps parser output', async () => {
    const s = await claudeAuthStatus({ listGlobalSecretsRaw: async () => '(global)   service   anthropic   (oauth configured)' })
    expect(s.anthropic).toBe('oauth')
  })
  it('claudeAuthStatus fails open to none on adapter error', async () => {
    const s = await claudeAuthStatus({ listGlobalSecretsRaw: async () => { throw new Error('boom') } })
    expect(s.anthropic).toBe('none')
  })
  it('claudeSignOut removes the global anthropic secret', async () => {
    const removeSecret = vi.fn(async () => {})
    await claudeSignOut({ removeSecret })
    expect(removeSecret).toHaveBeenCalledWith('anthropic', { global: true })
  })
  it('hasAnthropicCredential is true when a service anthropic cred exists', () => {
    expect(hasAnthropicCredential(spec([{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }]))).toBe(true)
    expect(hasAnthropicCredential(spec([]))).toBe(false)
  })
  it('needsAuthNudge only when none AND no definition anthropic cred', () => {
    expect(needsAuthNudge('none', spec([]))).toBe(true)
    expect(needsAuthNudge('oauth', spec([]))).toBe(false)
    expect(needsAuthNudge('apikey', spec([]))).toBe(false)
    expect(needsAuthNudge('none', spec([{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }]))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- auth/manager`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the glue**

Create `src/main/auth/manager.ts`:

```ts
import type { DefinitionSpec } from '@shared/types'
import { parseClaudeAuth, type AuthStatus, type ClaudeAuthKind } from './status'

export async function claudeAuthStatus(deps: { listGlobalSecretsRaw: () => Promise<string> }): Promise<AuthStatus> {
  try {
    return { anthropic: parseClaudeAuth(await deps.listGlobalSecretsRaw()) }
  } catch {
    return { anthropic: 'none' } // fail open to the nudge; never block on detection
  }
}

export async function claudeSignOut(deps: { removeSecret: (s: string, o: { global?: boolean }) => Promise<void> }): Promise<void> {
  await deps.removeSecret('anthropic', { global: true })
}

export function hasAnthropicCredential(spec: DefinitionSpec): boolean {
  return spec.credentials.some((c) => c.kind === 'service' && c.serviceId === 'anthropic')
}

export function needsAuthNudge(status: ClaudeAuthKind, spec: DefinitionSpec): boolean {
  return status === 'none' && !hasAnthropicCredential(spec)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- auth/manager`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/auth/manager.ts tests/main/auth/manager.test.ts
git commit -m "feat(auth): status/sign-out glue + pure launch-nudge decision"
```

---

### Task 5: IPC wiring (main + preload + renderer client + index.ts)

Exposes auth operations to the renderer and materializes the login kit in a temp dir.

**Files:**
- Modify: `src/main/ipc.ts` (Deps, handler map, handlers, registration)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/ipc/client.ts`
- Modify: `src/main/index.ts` (wire `loginKitDir`)
- Modify: `src/shared/types.ts` (export `AuthStatus`/`ClaudeAuthKind` if the renderer needs the type — re-export from auth or define here)
- Test: `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: Task 4 functions; `loginCommand` (Task 3); `deps.openTerminal`, `deps.store`, `deps.adapter`.
- Produces IPC:
  - `auth:status()` → `Result<AuthStatus>`
  - `auth:signOut()` → `Result<null>`
  - `auth:startLogin()` → `Result<{ name: string }>`
  - `auth:launchPrecheck(definitionId)` → `Result<{ needsNudge: boolean; status: ClaudeAuthKind }>`
- Renderer client methods: `authStatus`, `authSignOut`, `authStartLogin`, `authLaunchPrecheck`.

> **Type location:** define `ClaudeAuthKind`/`AuthStatus` in `src/shared/types.ts` and have `src/main/auth/status.ts` import them (so both main and renderer share one definition). Adjust Task 2's file to `import type { ClaudeAuthKind, AuthStatus } from '@shared/types'` and re-export if convenient. Do this refactor as Step 1 here.

- [ ] **Step 1: Move the auth types to shared**

In `src/shared/types.ts` add:

```ts
export type ClaudeAuthKind = 'oauth' | 'apikey' | 'none'
export interface AuthStatus { anthropic: ClaudeAuthKind }
```

In `src/main/auth/status.ts`, replace the local type declarations with `import type { AuthStatus, ClaudeAuthKind } from '@shared/types'` and `export type { AuthStatus, ClaudeAuthKind }`. Run `npm test -- auth` to confirm still green.

- [ ] **Step 2: Write the failing IPC test**

In `tests/main/ipc.test.ts`, add (adapt to the file's existing `buildHandlers`/deps setup):

```ts
it('auth:status returns the parsed Claude auth kind', async () => {
  const h = buildHandlers({ ...baseDeps, adapter: { ...adapter, listGlobalSecretsRaw: async () => '(global)   service   anthropic   (oauth configured)' } })
  const r = await h['auth:status']()
  expect(r.ok && r.data.anthropic).toBe('oauth')
})
it('auth:launchPrecheck flags a nudge for a no-credential definition when signed out', async () => {
  const store = { ...baseStore, getDefinitionSpec: () => ({ definition: { id: 'd', name: 'n', description: '', baseImage: 'i', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }) }
  const h = buildHandlers({ ...baseDeps, store, adapter: { ...adapter, listGlobalSecretsRaw: async () => 'No secrets found for scope "(global)".' } })
  const r = await h['auth:launchPrecheck']('d')
  expect(r.ok && r.data.needsNudge).toBe(true)
})
```

(Use whatever the file already names its base deps/adapter/store; add `listGlobalSecretsRaw: async () => ''` to the base adapter stub so other tests still typecheck.)

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- tests/main/ipc.test.ts`
Expected: FAIL — `auth:status`/`auth:launchPrecheck` handlers don't exist.

- [ ] **Step 4: Add handlers in ipc.ts**

Add imports:

```ts
import { claudeAuthStatus, claudeSignOut, needsAuthNudge } from './auth/manager'
import { loginCommand } from './sbx/translate'
import type { AuthStatus, ClaudeAuthKind } from '@shared/types'
```

Add to `Deps`:

```ts
loginKitDir?: () => string // materializes the OAuth login kit, returns its dir
```

Add to the `buildHandlers` return-type object:

```ts
'auth:status': () => Promise<Result<AuthStatus>>
'auth:signOut': () => Promise<Result<null>>
'auth:startLogin': () => Promise<Result<{ name: string }>>
'auth:launchPrecheck': (definitionId: string) => Promise<Result<{ needsNudge: boolean; status: ClaudeAuthKind }>>
```

Add the handler implementations (inside the returned object):

```ts
'auth:status': () => wrap(() => claudeAuthStatus(deps.adapter)),
'auth:signOut': () => wrap(async () => { await claudeSignOut(deps.adapter); return null }),
'auth:startLogin': () => wrap(async () => {
  if (!deps.loginKitDir) throw new Error('login kit not configured')
  const name = 'sbx-oauth-login'
  const kitDir = deps.loginKitDir()
  const workdir = kitDir.replace(/\/[^/]+$/, '') // login temp dir (kit lives under it)
  const cmd = loginCommand(workdir, name, kitDir)
  deps.log?.info(`Opening Claude OAuth login terminal: ${cmd}`)
  deps.openTerminal(cmd)
  return { name }
}),
'auth:launchPrecheck': (definitionId) => wrap(async () => {
  const spec = deps.store.getDefinitionSpec(definitionId)
  const { anthropic } = await claudeAuthStatus(deps.adapter)
  const needsNudge = spec ? needsAuthNudge(anthropic, spec) : false
  return { needsNudge, status: anthropic }
}),
```

Register them in `registerIpc`:

```ts
ipcMain.handle('auth:status', () => handlers['auth:status']())
ipcMain.handle('auth:signOut', () => handlers['auth:signOut']())
ipcMain.handle('auth:startLogin', () => handlers['auth:startLogin']())
ipcMain.handle('auth:launchPrecheck', (_e, id: string) => handlers['auth:launchPrecheck'](id))
```

- [ ] **Step 5: Wire `loginKitDir` in index.ts**

In `src/main/index.ts`, add a helper (near `materializeKit`) and pass it to `registerIpc`:

```ts
import { buildKitSpec, buildLoginKit } from './kit/generate'
// ...
function loginKitDir(): string {
  const dir = join(app.getPath('temp'), 'sbx-oauth-login')
  nodeFs.mkdirSync(dir, { recursive: true })
  const kitDir = `${dir}/.kit`
  return writeKit(buildLoginKit(), {}, { fs: kitFs, kitDir, secretsDir: `${dir}/.unused`, gitignorePath: `${dir}/.gitignore` }).kitDir
}
// ...
registerIpc({ adapter, store, probes: systemProbes, openTerminal: (c) => openHostTerminal(c), creds, materializeKit, readLoginEnv, loginKitDir, log: logger })
```

- [ ] **Step 6: Extend preload + renderer client**

In `src/preload/index.ts` add to `api`:

```ts
authStatus: () => ipcRenderer.invoke('auth:status'),
authSignOut: () => ipcRenderer.invoke('auth:signOut'),
authStartLogin: () => ipcRenderer.invoke('auth:startLogin'),
authLaunchPrecheck: (definitionId: string) => ipcRenderer.invoke('auth:launchPrecheck', definitionId),
```

In `src/renderer/ipc/client.ts` add to the `Api` interface and to the fallback object:

```ts
// interface
authStatus(): Promise<Result<AuthStatus>>
authSignOut(): Promise<Result<null>>
authStartLogin(): Promise<Result<{ name: string }>>
authLaunchPrecheck(definitionId: string): Promise<Result<{ needsNudge: boolean; status: ClaudeAuthKind }>>
// fallback
authStatus: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
authSignOut: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
authStartLogin: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
authLaunchPrecheck: async () => ({ ok: true, data: { needsNudge: false, status: 'none' } }),
```

Add `AuthStatus, ClaudeAuthKind` to the client's `@shared/types` import.

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test -- tests/main/ipc.test.ts` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts src/main/index.ts src/main/auth/status.ts src/shared/types.ts tests/main/ipc.test.ts
git commit -m "feat(auth): auth:status/signOut/startLogin/launchPrecheck IPC + login-kit wiring"
```

---

### Task 6: Settings → Accounts (status pill + Sign in / Sign out)

The one-time global sign-in surface.

**Files:**
- Create: `src/renderer/screens/AccountsSection.tsx`
- Modify: `src/renderer/screens/Settings.tsx` (render it + refresh on focus)
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Test: `tests/renderer/AccountsSection.test.tsx`

**Interfaces:**
- Consumes: `api.authStatus`, `api.authStartLogin`, `api.authSignOut`.
- Produces: `<AccountsSection />` — self-contained (does its own fetch), plus an exported presentational core if helpful for testing.

- [ ] **Step 1: Add i18n keys (en + de)**

In `src/renderer/i18n/en.ts`, add a `settings.accounts*` group (place inside the existing `settings` object):

```ts
accountsTitle: 'Accounts',
accountsSubtitle: 'Sign in to Claude Code with your Anthropic account (Max/Team/Enterprise). The OAuth token stays on your host and never enters a sandbox.',
accountClaude: 'Claude Code',
accountSignedInOauth: 'Signed in (OAuth)',
accountSignedInKey: 'API key configured',
accountSignedOut: 'Not signed in',
accountSignIn: 'Sign in',
accountSignOut: 'Sign out',
accountSignInHint: 'A Claude terminal will open. Type /login, complete the browser sign-in, then /exit.',
```

Add the same keys with German values to `src/renderer/i18n/de.ts` (e.g. `accountsTitle: 'Konten'`, `accountSignedInOauth: 'Angemeldet (OAuth)'`, `accountSignedOut: 'Nicht angemeldet'`, `accountSignIn: 'Anmelden'`, `accountSignOut: 'Abmelden'`, etc.).

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/AccountsSection.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AccountsSection } from '../../src/renderer/screens/AccountsSection'

const api = (globalThis as any)
beforeEach(() => {
  api.api = {
    authStatus: vi.fn(async () => ({ ok: true, data: { anthropic: 'none' } })),
    authStartLogin: vi.fn(async () => ({ ok: true, data: { name: 'sbx-oauth-login' } })),
    authSignOut: vi.fn(async () => ({ ok: true, data: null }))
  }
})

describe('AccountsSection', () => {
  it('shows Not signed in and a Sign in button, and calls startLogin', async () => {
    render(<AccountsSection />)
    await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(api.api.authStartLogin).toHaveBeenCalled()
  })
  it('shows Signed in (OAuth) and a Sign out button when authed', async () => {
    api.api.authStatus = vi.fn(async () => ({ ok: true, data: { anthropic: 'oauth' } }))
    render(<AccountsSection />)
    await waitFor(() => expect(screen.getByText(/signed in \(oauth\)/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(api.api.authSignOut).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- AccountsSection`
Expected: FAIL — component missing.

- [ ] **Step 4: Implement `AccountsSection`**

Create `src/renderer/screens/AccountsSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { ClaudeAuthKind } from '@shared/types'
import { api } from '../ipc/client'
import { useT } from '../i18n'

export function AccountsSection(): JSX.Element {
  const t = useT()
  const [kind, setKind] = useState<ClaudeAuthKind>('none')
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api.authStatus()
    if (r.ok) setKind(r.data.anthropic)
  }, [])
  useEffect(() => {
    void load()
    const onFocus = (): void => { void load() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const label = kind === 'oauth' ? t('settings.accountSignedInOauth') : kind === 'apikey' ? t('settings.accountSignedInKey') : t('settings.accountSignedOut')

  async function signIn(): Promise<void> {
    setNotice(t('settings.accountSignInHint'))
    const r = await api.authStartLogin()
    if (!r.ok) setNotice(r.error.message)
  }
  async function signOut(): Promise<void> {
    const r = await api.authSignOut()
    if (r.ok) await load(); else setNotice(r.error.message)
  }

  return (
    <div style={{ marginTop: 'var(--space-5)' }}>
      <h3 className="section-title" style={{ fontSize: 15 }}>{t('settings.accountsTitle')}</h3>
      <p className="section-desc">{t('settings.accountsSubtitle')}</p>
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span>
          <strong>{t('settings.accountClaude')}</strong>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
        </span>
        {kind === 'none'
          ? <button className="btn btn-primary btn-sm" onClick={() => void signIn()}>{t('settings.accountSignIn')}</button>
          : <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => void signOut()}>{t('settings.accountSignOut')}</button>}
      </div>
      {notice && <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)' }}>{notice}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Render it in Settings**

In `src/renderer/screens/Settings.tsx`, import `AccountsSection` and render it after `<GlobalSecrets .../>`:

```tsx
import { AccountsSection } from './AccountsSection'
// ...just before </section>:
<AccountsSection />
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- AccountsSection` then `npm run typecheck`
Expected: PASS (2 tests); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/screens/AccountsSection.tsx src/renderer/screens/Settings.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/AccountsSection.test.tsx
git commit -m "feat(settings): Accounts section — Claude OAuth sign in / sign out"
```

---

### Task 7: Launch-time nudge dialog + App wiring

The non-blocking gate when launching a no-credential definition.

**Files:**
- Create: `src/renderer/components/AuthNudge.tsx`
- Modify: `src/renderer/App.tsx` (precheck in `openLaunchDialog`; render `AuthNudge`; route its actions)
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Test: `tests/renderer/AuthNudge.test.tsx`

**Interfaces:**
- Consumes: `api.authLaunchPrecheck`, `api.authStartLogin`; existing `openEditor`, `setLaunchFor`.
- Produces: `<AuthNudge definition onProceed onSignIn onUseKey onCancel />`.

- [ ] **Step 1: Add i18n keys (en + de)**

In `en.ts` add an `auth` group (top-level, sibling of `credentials`):

```ts
auth: {
  nudgeTitle: 'Sign in to Claude for “{name}”',
  nudgeBody: 'No Anthropic credential is configured. You can sign in with your account when the session opens, sign in first, or use an API key.',
  proceed: 'Launch — sign in when it opens',
  signInFirst: 'Sign in first',
  useKey: 'Use an API key instead',
  cancel: 'Cancel'
},
```

Add the German equivalent to `de.ts`.

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/AuthNudge.test.tsx`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuthNudge } from '../../src/renderer/components/AuthNudge'

const def = { id: 'd', name: 'My Project', description: '', baseImage: 'i', tier: 'locked', createdAt: 't' } as any

describe('AuthNudge', () => {
  it('routes the three actions', () => {
    const onProceed = vi.fn(), onSignIn = vi.fn(), onUseKey = vi.fn()
    render(<AuthNudge definition={def} onProceed={onProceed} onSignIn={onSignIn} onUseKey={onUseKey} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /launch — sign in when it opens/i }))
    expect(onProceed).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /sign in first/i }))
    expect(onSignIn).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /use an api key/i }))
    expect(onUseKey).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- AuthNudge`
Expected: FAIL — component missing.

- [ ] **Step 4: Implement `AuthNudge`**

Create `src/renderer/components/AuthNudge.tsx`:

```tsx
import type { Definition } from '@shared/types'
import { useT } from '../i18n'

export function AuthNudge({ definition, onProceed, onSignIn, onUseKey, onCancel }: {
  definition: Definition
  onProceed: () => void
  onSignIn: () => void
  onUseKey: () => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('auth.nudgeTitle', { name: definition.name })} onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{t('auth.nudgeTitle', { name: definition.name })}</h3>
        <p className="modal-desc">{t('auth.nudgeBody')}</p>
        <div className="modal-actions" style={{ marginTop: 'var(--space-5)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" onClick={onUseKey}>{t('auth.useKey')}</button>
          <button className="btn btn-secondary" onClick={onSignIn}>{t('auth.signInFirst')}</button>
          <button className="btn btn-primary" onClick={onProceed}>{t('auth.proceed')}</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire into App.tsx**

In `src/renderer/App.tsx`:
- Import `AuthNudge`.
- Add state: `const [nudgeFor, setNudgeFor] = useState<Definition | null>(null)`.
- Change `openLaunchDialog` to run the precheck first:

```tsx
async function openLaunchDialog(definitionId: string): Promise<void> {
  const def = defs.find((d) => d.id === definitionId)
  if (!def) return
  setNotice(null)
  const pre = await api.authLaunchPrecheck(def.id)
  if (pre.ok && pre.data.needsNudge) { setNudgeFor(def); return }
  setLaunchFor(def)
  void loadInstances()
}
```

(Update the `onLaunch={openLaunchDialog}` call site to `onLaunch={(id) => void openLaunchDialog(id)}`.)

- Render the nudge near `LaunchDialog`:

```tsx
{nudgeFor && (
  <AuthNudge
    definition={nudgeFor}
    onProceed={() => { const d = nudgeFor; setNudgeFor(null); setLaunchFor(d); void loadInstances() }}
    onSignIn={() => { setNudgeFor(null); void api.authStartLogin() }}
    onUseKey={() => { const d = nudgeFor; setNudgeFor(null); void openEditor(d.id) }}
    onCancel={() => setNudgeFor(null)}
  />
)}
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npm test -- AuthNudge` then `npm run typecheck` then `npm run build`
Expected: PASS; typecheck clean; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/AuthNudge.tsx src/renderer/App.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/AuthNudge.test.tsx
git commit -m "feat(launch): non-blocking OAuth sign-in nudge when no credential is configured"
```

---

### Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green (261 prior + new auth/kit/renderer tests).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual smoke (optional, needs the user)**

- Settings → Accounts shows *Signed in (OAuth)* (the global token from the spike persists) with a **Sign out** button.
- Sign out → pill flips to *Not signed in*; **Sign in** opens a Claude terminal; `/login` completes (domains allowlisted by the login kit).
- Launch a locked-tier definition with no anthropic credential → the nudge appears; **Launch — sign in when it opens** opens the session and `/login` works.

- [ ] **Step 5: Finish the branch**

Announce and use `superpowers:finishing-a-development-branch` to verify tests and present merge/PR options.

---

## Self-Review

**Spec coverage:** A (detection) → Tasks 2, 5. B (Settings sign-in) → Tasks 3, 5, 6. C (launch nudge + allowlist baseline) → Tasks 1, 4, 7. D (interfaces) → Tasks 3, 4, 5. Testing section → each task's tests + Task 8. All covered.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `ClaudeAuthKind`/`AuthStatus` defined once in `@shared/types` (Task 5 Step 1) and imported by `status.ts`, the IPC layer, the client, and the renderer. `loginCommand(workdir, name, kitDir)` signature matches Task 3 impl and Task 5 usage. `needsAuthNudge(status, spec)` / `hasAnthropicCredential(spec)` names match between Task 4 and the IPC handler. `listGlobalSecretsRaw` name matches across adapter, stubs, and manager deps.
