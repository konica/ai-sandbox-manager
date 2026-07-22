# Advanced Custom Kit YAML (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Advanced" wizard step where a user pastes a kit `commands:` block (install/startup/initFiles) that is stored on the definition and merged into the app-generated kit at launch.

**Architecture:** A shared pure `normalizeCommandsYaml` (js-yaml) validates/normalizes the snippet. It's stored on `DefinitionSpec.kitCommandsYaml` (DB column, schema v8), merged into `buildKitSpec`'s generated `spec.yaml` (disjoint `commands:` key appended after `network:`). A `kit:validate` IPC shells `sbx kit validate` (advisory). The wizard gains step 6 (Advanced), Review shifts to 7.

**Tech Stack:** Electron + electron-vite, React + TS, better-sqlite3, js-yaml (new), Vitest.

## Global Constraints

- Run tests with **`npm test`** (the `pretest` hook flips the better-sqlite3 ABI). Never bare `vitest`. Also `npm run typecheck` and `npm run build`.
- i18n: `de: Dict` must have the same keys as `en` (enforced by typecheck). Add every new key to both `src/renderer/i18n/en.ts` and `de.ts`.
- New dependency `js-yaml` + `@types/js-yaml`. After install, the lockfile `resolved` URLs **must stay on `registry.npmjs.org`** — if `npm install` re-bakes `artifacts.mgm-tp.com`, rewrite them back (`sed -i '' 's|https://artifacts.mgm-tp.com:443/artifactory/api/npm/npm-repos/|https://registry.npmjs.org/|g; s|https://artifacts.mgm-tp.com/artifactory/api/npm/npm-repos/|https://registry.npmjs.org/|g' package-lock.json`) or CI breaks with ENOTFOUND.
- ESM project (`"type": "module"`): `import yaml from 'js-yaml'`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Work on a branch off `main` (e.g. `feat/advanced-kit-yaml`); do not commit to `main` directly.
- The Advanced editor accepts ONLY a `commands:` block (install/startup/initFiles). The app keeps owning `network.allowedDomains`/`name`.

---

## File Structure

- `src/shared/kit-commands.ts` — Create: `normalizeCommandsYaml` (pure; shared by renderer + main so both Reformat/save-gate and buildKitSpec/validate use one implementation).
- `src/shared/types.ts` — Modify: add `kitCommandsYaml?: string` to `DefinitionSpec`.
- `src/main/store/db.ts` — Modify: schema v8 + migration + persist/read `kit_commands_yaml`.
- `src/main/kit/generate.ts` — Modify: `buildKitSpec` appends the `commands:` block.
- `src/main/sbx/adapter.ts` — Modify: add `validateKit(dir)`.
- `src/main/ipc.ts` — Modify: add `kit:validate` handler + registration.
- `src/preload/index.ts`, `src/renderer/ipc/client.ts` — Modify: expose `kitValidate`.
- `src/renderer/wizard/draft.ts` — Modify: `kitCommandsYaml` field, step wiring (TOTAL_STEPS 7, stepKeys), `toSpec`/`draftFromSpec`, `setField`.
- `src/renderer/wizard/CreateDefinition.tsx` — Modify: Advanced step panel + save parse-gate.
- `src/renderer/i18n/en.ts`, `de.ts` — Modify: Advanced strings + `wizard.steps.advanced`.
- Tests: `tests/shared/kit-commands.test.ts`, `tests/main/kit-generate.test.ts` (existing — extend), `tests/main/db.test.ts` (existing — extend), `tests/main/ipc-*.test.ts`, `tests/renderer/wizard/*`.

---

## Task 1: `normalizeCommandsYaml` helper + js-yaml

**Files:**
- Modify: `package.json` (add deps), `package-lock.json`
- Create: `src/shared/kit-commands.ts`
- Test: `tests/shared/kit-commands.test.ts`

**Interfaces:**
- Produces: `normalizeCommandsYaml(text: string): { ok: true; yaml: string } | { ok: false; error: string }`. Empty/whitespace input → `{ ok: true, yaml: '' }`. Consumed by Tasks 3 (buildKitSpec), 4 (validate), 5 (wizard).

- [ ] **Step 1: Add js-yaml**

Run: `npm install js-yaml @types/js-yaml`
Then verify the lockfile stayed on public npm (Global Constraints); rewrite if needed:
```bash
grep -c "artifacts.mgm-tp.com" package-lock.json   # expect 0
```

- [ ] **Step 2: Write the failing test**

Create `tests/shared/kit-commands.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeCommandsYaml } from '../../src/shared/kit-commands'

describe('normalizeCommandsYaml', () => {
  it('accepts and normalizes a commands block', () => {
    const r = normalizeCommandsYaml('commands:\n  install: |\n    apt-get update\n')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.yaml).toContain('commands:')
  })
  it('treats empty input as ok/empty', () => {
    expect(normalizeCommandsYaml('   ')).toEqual({ ok: true, yaml: '' })
  })
  it('rejects unparseable YAML', () => {
    expect(normalizeCommandsYaml('commands: [oops').ok).toBe(false)
  })
  it('rejects non-commands top-level keys', () => {
    expect(normalizeCommandsYaml('network:\n  allowedDomains: [a.com]').ok).toBe(false)
  })
  it('rejects unknown commands.* keys', () => {
    expect(normalizeCommandsYaml('commands:\n  bogus: x').ok).toBe(false)
  })
  it('rejects wrong types', () => {
    expect(normalizeCommandsYaml('commands:\n  install: [1,2]').ok).toBe(false)
    expect(normalizeCommandsYaml('commands:\n  initFiles: nope').ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- kit-commands`
Expected: FAIL — cannot find module `../../src/shared/kit-commands`.

- [ ] **Step 4: Implement**

Create `src/shared/kit-commands.ts`:

```ts
import yaml from 'js-yaml'

const ALLOWED_CMD = new Set(['install', 'startup', 'initFiles'])

/**
 * Validate + normalize a user-supplied kit `commands:` block (install/startup/initFiles).
 * Shared by the wizard (Reformat + save gate) and the main process (kit merge + validate).
 * Empty/whitespace input is valid and yields ''. Only a single top-level `commands` key is
 * allowed; deeper structural validation is left to `sbx kit validate` (advisory).
 */
export function normalizeCommandsYaml(text: string): { ok: true; yaml: string } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, yaml: '' }
  let doc: unknown
  try {
    doc = yaml.load(trimmed)
  } catch (e) {
    return { ok: false, error: `Invalid YAML: ${(e as Error).message}` }
  }
  if (doc == null) return { ok: true, yaml: '' }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: 'Expected a YAML mapping with a top-level "commands:" key.' }
  }
  const obj = doc as Record<string, unknown>
  const extra = Object.keys(obj).filter((k) => k !== 'commands')
  if (extra.length) return { ok: false, error: `Only a top-level "commands:" key is allowed (found: ${extra.join(', ')}).` }
  const commands = obj.commands
  if (commands === undefined) return { ok: false, error: 'Missing "commands:" key.' }
  if (typeof commands !== 'object' || commands === null || Array.isArray(commands)) {
    return { ok: false, error: '"commands" must be a mapping of install/startup/initFiles.' }
  }
  const cmd = commands as Record<string, unknown>
  const badKeys = Object.keys(cmd).filter((k) => !ALLOWED_CMD.has(k))
  if (badKeys.length) return { ok: false, error: `commands supports only install, startup, initFiles (found: ${badKeys.join(', ')}).` }
  if ('install' in cmd && typeof cmd.install !== 'string') return { ok: false, error: 'commands.install must be a string.' }
  if ('startup' in cmd && typeof cmd.startup !== 'string') return { ok: false, error: 'commands.startup must be a string.' }
  if ('initFiles' in cmd && !Array.isArray(cmd.initFiles)) return { ok: false, error: 'commands.initFiles must be a list.' }
  return { ok: true, yaml: yaml.dump({ commands: cmd }, { lineWidth: -1 }).trimEnd() + '\n' }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- kit-commands`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/shared/kit-commands.ts tests/shared/kit-commands.test.ts
git commit -m "feat(kit): normalizeCommandsYaml helper + js-yaml

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Persist `kitCommandsYaml` on the definition

**Files:**
- Modify: `src/shared/types.ts` (DefinitionSpec)
- Modify: `src/main/store/db.ts` (schema v8, migration, insert/update/get)
- Test: `tests/main/db.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DefinitionSpec.kitCommandsYaml?: string` persisted and round-tripped by the store. Consumed by Tasks 3, 5.

- [ ] **Step 1: Add the field to `DefinitionSpec`**

In `src/shared/types.ts`, extend the interface:

```ts
export interface DefinitionSpec {
  definition: Definition
  mounts: MountIntent[]
  domains: string[]
  ports: PortIntent[]
  hostServices: HostServiceIntent[]
  credentials: CredentialRef[]
  ssh?: SshConfig
  /** Optional custom kit `commands:` block (install/startup/initFiles), normalized. */
  kitCommandsYaml?: string
}
```

- [ ] **Step 2: Write the failing test**

In `tests/main/db.test.ts`, add:

```ts
it('persists and reads kitCommandsYaml on a definition', () => {
  const store = openStore(':memory:')
  const spec = {
    definition: { id: 'k1', name: 'k', description: '', baseImage: 'img', tier: 'locked' as const, createdAt: 't' },
    mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }],
    domains: [], ports: [], hostServices: [], credentials: [],
    kitCommandsYaml: 'commands:\n  install: echo hi\n'
  }
  store.insertDefinitionSpec(spec)
  expect(store.getDefinitionSpec('k1')?.kitCommandsYaml).toBe('commands:\n  install: echo hi\n')
  store.updateDefinitionSpec({ ...spec, kitCommandsYaml: 'commands:\n  startup: echo bye\n' })
  expect(store.getDefinitionSpec('k1')?.kitCommandsYaml).toBe('commands:\n  startup: echo bye\n')
})
```

Run: `npm test -- db` → Expected: FAIL (kitCommandsYaml undefined).

- [ ] **Step 3: Schema v8 + migration**

In `src/main/store/db.ts`, add the column to the `definition` CREATE TABLE (after `ssh_commit_signing`):

```
  ssh_commit_signing INTEGER NOT NULL DEFAULT 0,
  kit_commands_yaml TEXT
```

Bump `PRAGMA user_version = 7;` → `PRAGMA user_version = 8;`.

Add the migration after the v6→v7 `instance_meta` block:

```ts
  // v7 → v8: definitions gain an optional custom kit commands block. Non-destructive.
  if (!defCols.includes('kit_commands_yaml')) {
    db.exec(`ALTER TABLE definition ADD COLUMN kit_commands_yaml TEXT;`)
  }
```

(`defCols` is already computed above for the ssh migration; reuse it.)

- [ ] **Step 4: Persist on insert/update, read on get**

`insertDefinitionSpec` — add the column + value:
```ts
        db.prepare(
          `INSERT INTO definition (id, name, description, base_image, tier, created_at, ssh_forward_agent, ssh_commit_signing, kit_commands_yaml)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(s.definition.id, s.definition.name, s.definition.description, s.definition.baseImage, s.definition.tier, s.definition.createdAt,
          ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null)
```

`updateDefinitionSpec` — add to the SET list + arg:
```ts
        const res = db.prepare(
          `UPDATE definition SET name = ?, description = ?, base_image = ?, tier = ?, ssh_forward_agent = ?, ssh_commit_signing = ?, kit_commands_yaml = ? WHERE id = ?`
        ).run(s.definition.name, s.definition.description, s.definition.baseImage, s.definition.tier,
          ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null, s.definition.id)
```

`getDefinitionSpec` — read it and include in the returned object. After the `sshRow` line, add:
```ts
      const kitRow = db.prepare(`SELECT kit_commands_yaml AS y FROM definition WHERE id = ?`).get(id) as { y: string | null } | undefined
      const kitCommandsYaml = kitRow?.y ?? undefined
      return { definition: def, mounts, domains, ports, hostServices, credentials, ssh, kitCommandsYaml }
```

- [ ] **Step 5: Run tests**

Run: `npm test -- db` → Expected: PASS. Then `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/store/db.ts tests/main/db.test.ts
git commit -m "feat(store): persist kitCommandsYaml on definitions (schema v8)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Merge the commands block into the generated kit

**Files:**
- Modify: `src/main/kit/generate.ts` (`buildKitSpec`)
- Test: `tests/main/kit-generate.test.ts` (extend; if absent, create)

**Interfaces:**
- Consumes: `normalizeCommandsYaml` (Task 1), `DefinitionSpec.kitCommandsYaml` (Task 2).
- Produces: `buildKitSpec(spec).specYaml` includes a `commands:` block when the spec has one.

- [ ] **Step 1: Write the failing test**

In `tests/main/kit-generate.test.ts` add (adapt the existing spec factory if present):

```ts
it('appends the commands block when the spec has kitCommandsYaml', () => {
  const spec = { definition: { id: 'abcd1234', name: 'k', description: '', baseImage: 'img', tier: 'locked' as const, createdAt: 't' }, mounts: [], domains: ['a.com'], ports: [], hostServices: [], credentials: [], kitCommandsYaml: 'commands:\n  install: echo hi\n' }
  const y = buildKitSpec(spec as never).specYaml
  expect(y).toContain('commands:')
  expect(y).toContain('echo hi')
  expect(y).toContain('allowedDomains') // app still owns network
})
it('omits commands when kitCommandsYaml is absent', () => {
  const spec = { definition: { id: 'abcd1234', name: 'k', description: '', baseImage: 'img', tier: 'locked' as const, createdAt: 't' }, mounts: [], domains: ['a.com'], ports: [], hostServices: [], credentials: [] }
  expect(buildKitSpec(spec as never).specYaml).not.toContain('commands:')
})
```

Run: `npm test -- kit-generate` → Expected: FAIL (no commands appended).

- [ ] **Step 2: Implement the merge**

In `src/main/kit/generate.ts`, add the import at the top:
```ts
import { normalizeCommandsYaml } from '@shared/kit-commands'
```

In `buildKitSpec`, after the `if (domains.length) { … }` network block and before `return`:
```ts
  // Merge the user's custom kit commands (install/startup/initFiles). Disjoint top-level
  // key from network/name, so a normalized append is a valid merge. Defensive: skip if it
  // somehow doesn't normalize (the wizard save gate blocks invalid YAML upstream).
  const norm = normalizeCommandsYaml(spec.kitCommandsYaml ?? '')
  if (norm.ok && norm.yaml.trim()) lines.push(norm.yaml.trimEnd())
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npm test -- kit-generate` → PASS. `npm run typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/kit/generate.ts tests/main/kit-generate.test.ts
git commit -m "feat(kit): merge custom commands block into the generated kit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `kit:validate` IPC (advisory `sbx kit validate`)

**Files:**
- Modify: `src/main/sbx/adapter.ts` (add `validateKit`), `src/main/ipc.ts` (handler + registration), `src/preload/index.ts`, `src/renderer/ipc/client.ts`
- Modify: `src/shared/types.ts` (KitValidation result type)
- Test: `tests/main/ipc-*.test.ts` (extend a lifecycle/handlers test) + adapter mock updates

**Interfaces:**
- Consumes: `normalizeCommandsYaml` (Task 1), `buildKitSpec` (Task 3), the OS temp dir + fs.
- Produces: `kit:validate(yaml: string): Promise<Result<KitValidation>>` where `KitValidation = { status: 'valid' | 'invalid' | 'unavailable'; message: string }`.

- [ ] **Step 1: Add the result type**

In `src/shared/types.ts`:
```ts
export interface KitValidation {
  status: 'valid' | 'invalid' | 'unavailable'
  message: string
}
```

- [ ] **Step 2: Add `validateKit` to the adapter**

In `src/main/sbx/adapter.ts`, add to the `SbxAdapter` interface:
```ts
  /** Run `sbx kit validate <dir>`; non-throwing. Missing sbx → resolves, never rejects. */
  validateKit(dir: string): Promise<{ code: number; out: string; ran: boolean }>
```
Implement inside `createSbxAdapter` (mirrors `checkDockerAuth` — bypasses `runSbx` throw-on-nonzero):
```ts
  async function validateKit(dir: string): Promise<{ code: number; out: string; ran: boolean }> {
    logger?.command(['kit', 'validate', dir])
    try {
      const res = await spawnFn('sbx', ['kit', 'validate', dir], {})
      return { code: res.code, out: (res.stdout + res.stderr).trim(), ran: true }
    } catch (e) {
      logger?.error(`sbx kit validate unavailable: ${(e as Error).message}`)
      return { code: -1, out: (e as Error).message, ran: false }
    }
  }
```
Add `validateKit` to the returned object.

- [ ] **Step 3: Add the `kit:validate` handler**

In `src/main/ipc.ts`, add to the handlers type block:
```ts
  'kit:validate': (yaml: string) => Promise<Result<KitValidation>>
```
Add `KitValidation` to the `@shared/types` import. Add the handler (near the def handlers). It writes a throwaway kit to a temp dir and validates it:
```ts
    'kit:validate': (yaml) => wrap(async () => {
      const norm = normalizeCommandsYaml(yaml)
      if (!norm.ok) return { status: 'invalid', message: norm.error } as KitValidation
      // Build a minimal kit spec.yaml carrying just these commands and validate it.
      const specYaml = `schemaVersion: "1"\nkind: mixin\nname: kit-validate\n${norm.yaml}`
      const dir = nodeFs.mkdtempSync(join(os.tmpdir(), 'sbx-kit-'))
      try {
        nodeFs.writeFileSync(join(dir, 'spec.yaml'), specYaml, { mode: 0o644 })
        const r = await deps.adapter.validateKit(dir)
        if (!r.ran) return { status: 'unavailable', message: 'Validation unavailable (sbx not found).' } as KitValidation
        return { status: r.code === 0 ? 'valid' : 'invalid', message: r.out || (r.code === 0 ? 'Valid kit.' : `sbx kit validate exited ${r.code}`) } as KitValidation
      } finally {
        try { nodeFs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
      }
    }),
```
Add imports at the top of `ipc.ts` if missing: `import * as nodeFs from 'node:fs'`, `import os from 'node:os'`, `import { join } from 'node:path'`, `import { normalizeCommandsYaml } from '@shared/kit-commands'`. (Check existing imports first; `join` may already be imported.)

Register it:
```ts
  ipcMain.handle('kit:validate', (_e, yaml: string) => handlers['kit:validate'](yaml))
```

- [ ] **Step 4: Preload + client**

`src/preload/index.ts`:
```ts
  kitValidate: (yaml: string) => ipcRenderer.invoke('kit:validate', yaml),
```
`src/renderer/ipc/client.ts` — interface + fallback:
```ts
  kitValidate(yaml: string): Promise<Result<KitValidation>>
```
```ts
  kitValidate: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
```
Add `KitValidation` to the client's `@shared/types` import.

- [ ] **Step 5: Write + run a handler test**

In an existing handlers test (e.g. `tests/main/ipc.test.ts`) add a mock `validateKit` to the adapter and:
```ts
it('kit:validate returns invalid for unparseable YAML without shelling out', async () => {
  const h = buildHandlers({ adapter, store: openStore(':memory:'), probes, openTerminal: () => {} } as never)
  const r = await h['kit:validate']('commands: [oops')
  expect(r).toEqual({ ok: true, data: { status: 'invalid', message: expect.stringMatching(/YAML/i) } })
})
```
Add `validateKit: async () => ({ code: 0, out: 'ok', ran: true })` to the `adapter` object in that file (and any other test files whose adapter must satisfy the full `SbxAdapter` type — `tsc` will point them out).

Run: `npm test -- ipc` and `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/sbx/adapter.ts src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc.test.ts
git commit -m "feat(kit): kit:validate IPC via sbx kit validate (advisory)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Advanced wizard step

**Files:**
- Modify: `src/renderer/wizard/draft.ts` (field, step wiring, toSpec/draftFromSpec, setField)
- Modify: `src/renderer/wizard/CreateDefinition.tsx` (Advanced panel + save gate)
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Test: `tests/renderer/wizard/draft.test.ts`, `tests/renderer/wizard/CreateDefinition.test.tsx`

**Interfaces:**
- Consumes: `normalizeCommandsYaml` (Task 1), `api.kitValidate` (Task 4), `DefinitionSpec.kitCommandsYaml` (Task 2).

- [ ] **Step 1: Draft wiring — write failing tests**

In `tests/renderer/wizard/draft.test.ts` add:
```ts
it('round-trips kitCommandsYaml through toSpec/draftFromSpec', () => {
  const d = { ...initialDraft, workspace: '/w', name: 'p', kitCommandsYaml: 'commands:\n  install: echo hi\n' }
  const spec = toSpec(d, 'id', 't')
  expect(spec.kitCommandsYaml).toBe('commands:\n  install: echo hi\n')
  expect(draftFromSpec(spec).kitCommandsYaml).toBe('commands:\n  install: echo hi\n')
})
it('omits kitCommandsYaml from the spec when blank', () => {
  const spec = toSpec({ ...initialDraft, workspace: '/w', name: 'p', kitCommandsYaml: '   ' }, 'id', 't')
  expect(spec.kitCommandsYaml).toBeUndefined()
})
```

Run: `npm test -- wizard/draft` → Expected: FAIL.

- [ ] **Step 2: Draft implementation**

In `src/renderer/wizard/draft.ts`:
- Bump `export const TOTAL_STEPS = 6` → `7`.
- Add to the `Draft` interface: `kitCommandsYaml: string`.
- Add to `initialDraft`: `kitCommandsYaml: ''`.
- Add `'kitCommandsYaml'` to the `setField` action's `field` union:
  ```ts
  | { type: 'setField'; field: 'name' | 'description' | 'customImageRef' | 'workspace' | 'kitCommandsYaml'; value: string }
  ```
  (the existing `case 'setField': return { ...d, [a.field]: a.value }` already handles it.)
- In `toSpec`, add to the returned object (after `ssh`):
  ```ts
    kitCommandsYaml: d.kitCommandsYaml.trim() ? d.kitCommandsYaml.trim() : undefined
  ```
- In `draftFromSpec`, add to the returned object:
  ```ts
    kitCommandsYaml: spec.kitCommandsYaml ?? ''
  ```

Run: `npm test -- wizard/draft` → PASS.

- [ ] **Step 3: Step labels (i18n) + stepKeys**

In `src/renderer/wizard/CreateDefinition.tsx`, extend `stepKeys`:
```ts
  const stepKeys = ['workspace', 'baseImage', 'network', 'credentials', 'ports', 'advanced', 'review']
```
In `src/renderer/i18n/en.ts` `wizard.steps`, add `advanced: 'Advanced'`; in `de.ts`, `advanced: 'Erweitert'`. Renumber nothing else — `steps` is a keyed object.

- [ ] **Step 4: Advanced panel + Review shift**

In `CreateDefinition.tsx`, the Review panel currently renders at `draft.step === 6`. Change it to `draft.step === 7`, and add the Advanced panel at `draft.step === 6`:

```tsx
          {draft.step === 6 && (
            <>
              <h3 style={{ fontSize: 15, marginBottom: 'var(--space-1)' }}>{t('wizard.advancedTitle')}</h3>
              <p className="section-desc" style={{ marginTop: 0 }}>{t('wizard.advancedSubtitle')} <a href="https://docs.docker.com/ai/sandboxes/customize/kit-reference/" target="_blank" rel="noreferrer">{t('wizard.kitReference')}</a></p>
              <label htmlFor="kit-yaml">{t('wizard.customKitYaml')}</label>
              <textarea
                id="kit-yaml" aria-label="Custom kit YAML" className="input input-mono"
                style={{ minHeight: 160, resize: 'vertical', fontFamily: 'var(--font-mono, monospace)' }}
                placeholder={'commands:\n  install: |\n    apt-get update && apt-get install -y ...\n  startup: |\n    ...\n  initFiles:\n    - path: /home/agent/.config/tool.yaml\n      contents: |\n        ...'}
                value={draft.kitCommandsYaml}
                onChange={(e) => { dispatch({ type: 'setField', field: 'kitCommandsYaml', value: e.target.value }); setKitMsg(null) }}
              />
              <p className="section-desc" style={{ fontSize: 11, marginTop: 'var(--space-1)' }}>{t('wizard.customKitYamlHelp')}</p>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => {
                  const r = normalizeCommandsYaml(draft.kitCommandsYaml)
                  if (r.ok) { dispatch({ type: 'setField', field: 'kitCommandsYaml', value: r.yaml }); setKitMsg({ kind: 'ok', text: t('wizard.kitReformatted') }) }
                  else setKitMsg({ kind: 'error', text: r.error })
                }}>{t('wizard.reformat')}</button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={async () => {
                  const res = await api.kitValidate(draft.kitCommandsYaml)
                  if (!res.ok) { setKitMsg({ kind: 'error', text: res.error.message }); return }
                  setKitMsg({ kind: res.data.status === 'invalid' ? 'error' : 'ok', text: res.data.message })
                }}>{t('wizard.validate')}</button>
              </div>
              {kitMsg && <p style={{ fontSize: 12, marginTop: 'var(--space-2)', color: kitMsg.kind === 'error' ? 'var(--danger)' : 'var(--success, var(--accent))' }}>{kitMsg.text}</p>}
              <div className="card" style={{ marginTop: 'var(--space-4)', opacity: 0.6 }}>
                <strong style={{ fontSize: 13 }}>{t('wizard.communityMixins')}</strong>
                <p className="section-desc" style={{ margin: 0 }}>{t('wizard.communityMixinsComingSoon')}</p>
              </div>
            </>
          )}
```

Add near the other `useState` hooks:
```ts
  const [kitMsg, setKitMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
```
Add imports: `import { normalizeCommandsYaml } from '@shared/kit-commands'` (verify `@shared` alias resolves in the renderer — it does via electron.vite.config.ts renderer alias).

- [ ] **Step 5: Save parse-gate**

In `CreateDefinition.tsx` `submit()`, before building the spec, add:
```ts
    const kitCheck = normalizeCommandsYaml(draft.kitCommandsYaml)
    if (!kitCheck.ok) { dispatch({ type: 'goToStep', step: 6 }); setKitMsg({ kind: 'error', text: t('wizard.kitYamlInvalid', { message: kitCheck.error }) }); return }
```
This routes the user back to the Advanced step (6), where the `kitMsg` line (added in Step 4) renders the error — so no dependency on the review-only `error` display.

- [ ] **Step 6: i18n keys**

Add to `src/renderer/i18n/en.ts` `wizard`:
```ts
    advancedTitle: 'Advanced Settings',
    advancedSubtitle: 'Customize the sandbox with a kit — declarative config merged into the generated kit.',
    kitReference: 'Kit reference →',
    customKitYaml: 'Custom kit YAML',
    customKitYamlHelp: 'Paste a commands: block (install / startup / initFiles). Merged into this definition’s kit. Leave empty to skip.',
    reformat: 'Reformat',
    validate: 'Validate',
    kitReformatted: 'Formatted.',
    kitYamlInvalid: 'Custom kit YAML is invalid: {message}',
    communityMixins: 'Community Mixins',
    communityMixinsComingSoon: 'Browse and apply community mixin kits — coming soon.'
```
Add the German equivalents to `de.ts` (same keys):
```ts
    advancedTitle: 'Erweiterte Einstellungen',
    advancedSubtitle: 'Passen Sie die Sandbox mit einem Kit an — deklarative Konfiguration, die in das generierte Kit eingefügt wird.',
    kitReference: 'Kit-Referenz →',
    customKitYaml: 'Benutzerdefiniertes Kit-YAML',
    customKitYamlHelp: 'Fügen Sie einen commands:-Block ein (install / startup / initFiles). Wird in das Kit dieser Definition eingefügt. Leer lassen zum Überspringen.',
    reformat: 'Neu formatieren',
    validate: 'Validieren',
    kitReformatted: 'Formatiert.',
    kitYamlInvalid: 'Benutzerdefiniertes Kit-YAML ist ungültig: {message}',
    communityMixins: 'Community-Mixins',
    communityMixinsComingSoon: 'Community-Mixin-Kits durchsuchen und anwenden — demnächst.'
```

- [ ] **Step 7: Wizard tests**

In `tests/renderer/wizard/CreateDefinition.test.tsx` add (the test mock's `api` needs `kitValidate`; add `kitValidate: async () => ({ ok: true, data: { status: 'valid', message: 'ok' } })` to the `vi.mock('../../../src/renderer/ipc/client', …)` object):
```ts
it('blocks submit when the Advanced kit YAML is unparseable', async () => {
  render(<CreateDefinition onDone={() => {}} onCancel={() => {}} createId={() => 'id1'} now={() => 't'} />)
  fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: /next/i })) // → step 6 Advanced
  fireEvent.change(screen.getByLabelText('Custom kit YAML'), { target: { value: 'commands: [oops' } })
  fireEvent.click(screen.getByRole('button', { name: /next/i })) // → step 7 Review
  fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
  expect(await screen.findByText(/kit YAML is invalid/i)).toBeInTheDocument()
  expect(defCreate).not.toHaveBeenCalled()
})
```
Also update any existing test that walks to Review by clicking Next a fixed number of times — there is now one more step (Advanced), so loops that went to Review need one extra Next. `tsc`/failing tests will pinpoint them; adjust the counts.

Run: `npm test` (full) → all pass. `npm run typecheck` → clean. `npm run build` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/wizard/draft.ts src/renderer/wizard/CreateDefinition.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/wizard/draft.test.ts tests/renderer/wizard/CreateDefinition.test.tsx
git commit -m "feat(wizard): Advanced step with custom kit YAML editor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done criteria
- A definition can carry a `commands:` block; it round-trips through the wizard and DB.
- Launching that definition produces a kit `spec.yaml` containing both the app's
  `network.allowedDomains` and the user's `commands:`.
- Reformat normalizes valid YAML; Validate shows `sbx kit validate` results (or an
  "unavailable" note); saving is blocked on unparseable YAML.
- `npm test`, `npm run typecheck`, `npm run build` all green.
- Community Mixins shows a non-functional "coming soon" placeholder (Phase 2).
