# Configurable sandbox disk/volume size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a sandbox definition carry a default disk/volume size and let the user override it in the Launch dialog before a run, applied via the `DOCKER_SANDBOXES_DOCKER_SIZE` env var on `sbx create`.

**Architecture:** The definition-level default mirrors the existing CPU/memory feature layer for layer (type → shared validator → SQLite → wizard/draft → defio import). The launch-time override is new plumbing threaded `LaunchDialog → App → preload → IPC instance:launch → launchDefinition`. Disk size has no `sbx` CLI flag, so it is injected as an inline env-var prefix on the `sbx create` step inside the `launchCommand` shell string (the only path that provisions a volume).

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React, better-sqlite3, Vitest, `@testing-library/react`.

## Global Constraints

- Env var name is exactly `DOCKER_SANDBOXES_DOCKER_SIZE`; value is a size string like `50g` / `512m`. Default when absent is Docker's 50 GB — the app omits the env var entirely to get it.
- Disk-size input reuses the memory format/regex: `/^\d+(\.\d+)?\s*[mMgG]$/`. Empty = "use the Docker default".
- The store migration must be a **new** guarded block and bump `PRAGMA user_version` from `11` to `12`. Do not retrofit the existing cpus/memory block.
- i18n keys must be added to **both** `en.ts` and `de.ts` — `tests/renderer/i18n.test.ts` enforces key parity.
- Run `npm run typecheck` and `npm test` before claiming the work complete (CLAUDE.md).
- Known gotcha (from prior sessions): a running instance of the app or a stray worker holds the better-sqlite3 native ABI and can block main-process Vitest. If `tests/main/**` hangs or errors on the native module, close the app and re-run; renderer/shared suites and `npm run typecheck` are unaffected.

---

## File Structure

Files created/modified, by responsibility:

- `src/shared/resources.ts` — add `isValidDiskSize` / `parseDiskSize` (single source of truth for disk validation, shared by wizard, launch dialog, defio, toSpec).
- `src/shared/types.ts` — add `diskSize?: string` to `Definition`.
- `src/main/store/db.ts` — persist/read `disk_size`; migration v11→v12.
- `src/renderer/wizard/draft.ts` — draft `diskSize` field; seed/emit.
- `src/renderer/wizard/CreateDefinition.tsx` — wizard disk-size input + submit guard.
- `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts` — wizard + launch strings.
- `src/main/defio/bundle.ts` — validate `diskSize` on import.
- `src/main/sbx/translate.ts` — `launchCommand` injects the env var on the create step.
- `src/main/launch.ts` — `launchDefinition` resolves effective disk size (override ?? default).
- `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/ipc/client.ts` — thread `diskSize` through `instance:launch`.
- `src/renderer/components/LaunchDialog.tsx`, `src/renderer/App.tsx` — launch-dialog field pre-filled from the definition, threaded to `submitLaunch`.

Tests live beside their existing suites: `tests/shared/resources.test.ts`, `tests/main/store/db.test.ts`, `tests/renderer/wizard/draft.test.ts`, `tests/renderer/wizard/CreateDefinition.test.tsx`, `tests/main/defio/bundle.test.ts`, `tests/main/sbx/translate.test.ts`, `tests/main/launch.test.ts`, `tests/main/ipc-tags.test.ts` (extend), `tests/renderer/LaunchDialog.test.tsx`.

---

### Task 1: Shared disk-size validator/parser

**Files:**
- Modify: `src/shared/resources.ts`
- Test: `tests/shared/resources.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isValidDiskSize(s: string): boolean` — empty (trimmed) or matches `/^\d+(\.\d+)?\s*[mMgG]$/`.
  - `parseDiskSize(s: string): string | undefined` — normalized (lowercase unit, no spaces), or `undefined` when blank/invalid.

- [ ] **Step 1: Write the failing tests**

Append to `tests/shared/resources.test.ts` (add the two new names to the existing import on line 2: `import { isValidCpus, isValidMemory, parseCpus, parseMemory, isValidDiskSize, parseDiskSize } from '@shared/resources'`):

```ts
describe('isValidDiskSize', () => {
  it('accepts empty (= Docker default) and binary-unit sizes', () => {
    for (const s of ['', '  ', '50g', '512m', '2G', '1.5g']) expect(isValidDiskSize(s)).toBe(true)
  })
  it('rejects unitless numbers and junk', () => {
    for (const s of ['50', '10gb', 'g', 'abc', '50 g x']) expect(isValidDiskSize(s)).toBe(false)
  })
})

describe('parseDiskSize', () => {
  it('normalizes unit to lowercase and strips spaces, else undefined', () => {
    expect(parseDiskSize('50G')).toBe('50g')
    expect(parseDiskSize('512 m')).toBe('512m')
    expect(parseDiskSize('')).toBeUndefined()
    expect(parseDiskSize('50')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/resources.test.ts`
Expected: FAIL — `isValidDiskSize`/`parseDiskSize` are not exported.

- [ ] **Step 3: Implement the validator/parser**

Append to `src/shared/resources.ts` (after `parseMemory`). Reuse the memory shape — disk size uses the same binary-unit format:

```ts
const DISK_RE = /^\d+(\.\d+)?\s*[mMgG]$/

/** Empty (= Docker's 50 GB default) or a binary-unit size like `50g` / `512m`. */
export function isValidDiskSize(s: string): boolean {
  const t = s.trim()
  if (t === '') return true
  return DISK_RE.test(t)
}

/** Validated disk-size input → normalized (lowercase unit, no spaces), or undefined when blank/invalid. */
export function parseDiskSize(s: string): string | undefined {
  const t = s.trim()
  if (!DISK_RE.test(t)) return undefined
  return t.replace(/\s+/g, '').toLowerCase()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/resources.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/resources.ts tests/shared/resources.test.ts
git commit -m "$(cat <<'EOF'
feat(resources): disk-size validator/parser (isValidDiskSize/parseDiskSize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Definition type + SQLite persistence

**Files:**
- Modify: `src/shared/types.ts:23-24` (add field to `Definition`)
- Modify: `src/main/store/db.ts` (schema, migration, read map, INSERT/UPDATE/SELECT)
- Test: `tests/main/store/db.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (persistence stores the already-parsed value).
- Produces: `Definition.diskSize?: string`; the store round-trips it on `insertDefinition`, `insertDefinitionSpec`, `updateDefinitionSpec`, `getDefinition`, `getDefinitionSpec`, `listDefinitions`.

- [ ] **Step 1: Write the failing test**

Append to `tests/main/store/db.test.ts` inside the `describe('metadata-store', …)` block:

```ts
it('persists and reads diskSize on a definition spec', () => {
  const store = openStore(':memory:')
  const spec = {
    definition: { id: 'ds1', name: 'ds', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't', diskSize: '30g' },
    mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }],
    domains: [], ports: [], hostServices: [], credentials: []
  }
  store.insertDefinitionSpec(spec)
  expect(store.getDefinitionSpec('ds1')?.definition.diskSize).toBe('30g')
  store.updateDefinitionSpec({ ...spec, definition: { ...spec.definition, diskSize: '80g' } })
  expect(store.getDefinitionSpec('ds1')?.definition.diskSize).toBe('80g')
  store.close()
})

it('leaves diskSize undefined when absent', () => {
  const store = openStore(':memory:')
  store.insertDefinition({ id: 'ds2', name: 'ds2', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' })
  expect(store.getDefinition('ds2')?.diskSize).toBeUndefined()
  store.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/store/db.test.ts`
Expected: FAIL — `diskSize` is not persisted/read (undefined after insert, or a type error on the unknown field).

- [ ] **Step 3: Add the type field**

In `src/shared/types.ts`, add to the `Definition` interface after line 24 (`memory?`):

```ts
  diskSize?: string // optional block-volume size (e.g. '50g'); absent → Docker's 50 GB default (via DOCKER_SANDBOXES_DOCKER_SIZE)
```

- [ ] **Step 4: Add the column + migration in `db.ts`**

In `src/main/store/db.ts`:

(a) In the `SCHEMA` string, add the column to `CREATE TABLE … definition` (after `kit_commands_yaml TEXT` on line 39):

```sql
  kit_commands_yaml TEXT,
  cpus INTEGER,
  memory TEXT,
  disk_size TEXT
```

> Note: `cpus`/`memory` were added only via migration, so a fresh DB currently creates them through the migration too. Adding all three to the `CREATE TABLE` is harmless (a brand-new DB gets them here; an existing DB gets `disk_size` via the migration below). If `cpus`/`memory` are already present in the CREATE TABLE in your working copy, only add `disk_size`.

(b) Bump the version at the end of `SCHEMA` (line 115): `PRAGMA user_version = 12;`

(c) Add a new migration block immediately after the v10→v11 cpus/memory block (after line 169):

```ts
  // v11 → v12: definitions gain an optional block-volume size (create-time only, applied
  // via the DOCKER_SANDBOXES_DOCKER_SIZE env var — sbx has no CLI flag for it).
  // Non-destructive; NULL → env var omitted → sbx's 50 GB default.
  if (!defCols.includes('disk_size')) {
    db.exec(`ALTER TABLE definition ADD COLUMN disk_size TEXT;`)
  }
```

- [ ] **Step 5: Thread `disk_size` through read + write**

In `src/main/store/db.ts`:

(a) `defWithLimits` (after the `memory` line, ~186):

```ts
      memory: row.memory == null ? undefined : String(row.memory),
      diskSize: row.disk_size == null ? undefined : String(row.disk_size)
```

(b) `insertDefinition` (lines 224-227) — add the column, value, and bound param:

```ts
      db.prepare(
        `INSERT INTO definition (id, name, description, base_image, agent, tier, created_at, cpus, memory, disk_size)
         VALUES (@id, @name, @description, @baseImage, @agent, @tier, @createdAt, @cpus, @memory, @diskSize)`
      ).run({ ...d, cpus: d.cpus ?? null, memory: d.memory ?? null, diskSize: d.diskSize ?? null })
```

(c) The three SELECTs (`listDefinitions` ~230, `getDefinition` ~234, `getDefinitionSpec` ~263) — append `, disk_size` to each column list:

```ts
`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt, cpus, memory, disk_size FROM definition …`
```

(d) `insertDefinitionSpec` (lines 241-244) — add column, one `?`, and the value at the end:

```ts
        db.prepare(
          `INSERT INTO definition (id, name, description, base_image, agent, tier, created_at, ssh_forward_agent, ssh_commit_signing, kit_commands_yaml, cpus, memory, disk_size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(s.definition.id, s.definition.name, s.definition.description, s.definition.baseImage, s.definition.agent, s.definition.tier, s.definition.createdAt,
          ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null, s.definition.cpus ?? null, s.definition.memory ?? null, s.definition.diskSize ?? null)
```

(e) `updateDefinitionSpec` (lines 252-255) — add `disk_size = ?` and the value before the `WHERE id = ?` param:

```ts
        const res = db.prepare(
          `UPDATE definition SET name = ?, description = ?, base_image = ?, agent = ?, tier = ?, ssh_forward_agent = ?, ssh_commit_signing = ?, kit_commands_yaml = ?, cpus = ?, memory = ?, disk_size = ? WHERE id = ?`
        ).run(s.definition.name, s.definition.description, s.definition.baseImage, s.definition.agent, s.definition.tier,
          ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null, s.definition.cpus ?? null, s.definition.memory ?? null, s.definition.diskSize ?? null, s.definition.id)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/main/store/db.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/store/db.ts tests/main/store/db.test.ts
git commit -m "$(cat <<'EOF'
feat(store): persist and read Definition diskSize (migration v11->v12)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wizard draft layer

**Files:**
- Modify: `src/renderer/wizard/draft.ts`
- Test: `tests/renderer/wizard/draft.test.ts`

**Interfaces:**
- Consumes: `isValidDiskSize`, `parseDiskSize` (Task 1); `Definition.diskSize` (Task 2).
- Produces: `Draft.diskSize: string`; `setField` accepts `'diskSize'`; `canAdvance` gates step 2 on `isValidDiskSize`; `draftFromSpec` seeds it; `toSpec` emits `definition.diskSize`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/renderer/wizard/draft.test.ts` (match the file's existing import of `initialDraft`, `draftReducer`, `toSpec`, `draftFromSpec`, `canAdvance`):

```ts
describe('draft diskSize', () => {
  it('setField updates diskSize', () => {
    const d = draftReducer(initialDraft, { type: 'setField', field: 'diskSize', value: '40g' })
    expect(d.diskSize).toBe('40g')
  })
  it('toSpec parses diskSize (normalized) onto the definition', () => {
    const d = { ...initialDraft, workspace: '/w', diskSize: '40G' }
    expect(toSpec(d, 'id1', 't').definition.diskSize).toBe('40g')
  })
  it('draftFromSpec seeds diskSize from the definition (empty when absent)', () => {
    const base = { mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }
    const withDisk = { ...base, definition: { id: 'i', name: 'n', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't', diskSize: '30g' } }
    const without = { ...base, definition: { ...withDisk.definition, diskSize: undefined } }
    expect(draftFromSpec(withDisk).diskSize).toBe('30g')
    expect(draftFromSpec(without).diskSize).toBe('')
  })
  it('canAdvance blocks step 2 on an invalid diskSize', () => {
    const d = { ...initialDraft, step: 2, workspace: '/w', diskSize: '40gb' }
    expect(canAdvance(d)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/wizard/draft.test.ts`
Expected: FAIL — `diskSize` is not on the Draft / not handled.

- [ ] **Step 3: Wire `diskSize` into the draft**

In `src/renderer/wizard/draft.ts`:

(a) Import (line 6) — add the two functions:

```ts
import { isValidCpus, isValidMemory, parseCpus, parseMemory, isValidDiskSize, parseDiskSize } from '@shared/resources'
```

(b) `Draft` interface (after `memory: string`, line 76):

```ts
  memory: string
  diskSize: string
```

(c) `initialDraft` (after `memory: ''`, line 98):

```ts
  memory: '',
  diskSize: ''
```

(d) `setField` action union (line 105) — add `'diskSize'`:

```ts
  | { type: 'setField'; field: 'name' | 'description' | 'customImageRef' | 'workspace' | 'kitCommandsYaml' | 'cpus' | 'memory' | 'diskSize'; value: string }
```

(e) `canAdvance` step 2 (line 198):

```ts
  if (d.step === 2) return resolveBaseImage(d).length > 0 && isValidCpus(d.cpus) && isValidMemory(d.memory) && isValidDiskSize(d.diskSize)
```

(f) `draftFromSpec` return (after `memory:` line 239):

```ts
    memory: spec.definition.memory ?? '',
    diskSize: spec.definition.diskSize ?? ''
```

(g) `toSpec` definition object (line 245) — add `diskSize`:

```ts
    definition: { id, name: effectiveName(d), description: d.description.trim(), agent: d.agent, baseImage: resolveBaseImage(d), tier: d.tier, createdAt, cpus: parseCpus(d.cpus), memory: parseMemory(d.memory), diskSize: parseDiskSize(d.diskSize) },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/wizard/draft.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/wizard/draft.ts tests/renderer/wizard/draft.test.ts
git commit -m "$(cat <<'EOF'
feat(wizard): wire diskSize into the draft layer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wizard UI + i18n

**Files:**
- Modify: `src/renderer/wizard/CreateDefinition.tsx` (Step 2 input + submit guard)
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Test: `tests/renderer/wizard/CreateDefinition.test.tsx`

**Interfaces:**
- Consumes: `isValidDiskSize` (Task 1); `Draft.diskSize` + `setField 'diskSize'` (Task 3); i18n keys added here.
- Produces: a "Disk size" input in wizard Step 2 with inline validation; submit blocked + jumps to step 2 when invalid.

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/wizard/CreateDefinition.test.tsx` (match the file's existing render/setup helper; navigate to step 2 the same way its other step-2 tests do):

```ts
it('shows a disk-size input in step 2 and an inline error on an invalid value', () => {
  renderWizardOnStep(2) // use the file's existing step-2 navigation helper
  const disk = screen.getByLabelText('Disk size')
  fireEvent.change(disk, { target: { value: '40gb' } })
  expect(screen.getByText(/binary size like/i)).toBeInTheDocument()
  fireEvent.change(disk, { target: { value: '40g' } })
  expect(screen.queryByText(/binary size like/i)).toBeNull()
})
```

> If the suite has no `renderWizardOnStep` helper, follow the existing pattern its CPU/memory step-2 test uses to reach step 2 (render the wizard, then dispatch/click through to `draft.step === 2`), and assert on `getByLabelText('Disk size')`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/wizard/CreateDefinition.test.tsx`
Expected: FAIL — no "Disk size" input exists.

- [ ] **Step 3: Add the i18n keys (en + de)**

In `src/renderer/i18n/en.ts`, in the `wizard` block after `memoryInvalid` (line 412), before `resourcesNote`:

```ts
    diskSizeLabel: 'Disk size (optional)',
    diskSizePlaceholder: '50g — Docker default',
    diskSizeInvalid: 'Use a binary size like 50g or 512m, or leave blank for the default.',
```

In `src/renderer/i18n/de.ts`, in the `wizard` block after `memoryInvalid` (line 414), before `resourcesNote`:

```ts
    diskSizeLabel: 'Festplattengröße (optional)',
    diskSizePlaceholder: '50g — Docker-Standard',
    diskSizeInvalid: 'Binärgröße wie 50g oder 512m verwenden oder leer lassen für den Standard.',
```

- [ ] **Step 4: Add the input to Step 2**

In `src/renderer/wizard/CreateDefinition.tsx`:

(a) Import (line 9 imports the resources validators) — add `isValidDiskSize`:

```ts
import { isValidCpus, isValidMemory, isValidDiskSize } from '@shared/resources'
```

> Match the actual existing import line in the file; add `isValidDiskSize` to it.

(b) Insert the input after the memory block (after line 340, before the `resourcesNote` paragraph on line 342):

```tsx
              <label htmlFor="def-disk-size" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.diskSizeLabel')}</label>
              <input
                id="def-disk-size"
                aria-label="Disk size"
                className="input input-mono"
                placeholder={t('wizard.diskSizePlaceholder')}
                value={draft.diskSize}
                onChange={(e) => dispatch({ type: 'setField', field: 'diskSize', value: e.target.value })}
              />
              {!isValidDiskSize(draft.diskSize) && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, marginTop: 'var(--space-1)', marginBottom: 0 }}>{t('wizard.diskSizeInvalid')}</p>}
```

(c) Submit guard (`persist`, line 137) — extend the resource gate to include disk size:

```ts
    if (!isValidCpus(draft.cpus) || !isValidMemory(draft.memory) || !isValidDiskSize(draft.diskSize)) { dispatch({ type: 'goToStep', step: 2 }); setError(t('wizard.cpusInvalid')); return false }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/wizard/CreateDefinition.test.tsx tests/renderer/i18n.test.ts`
Expected: PASS (component test + i18n key parity).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/wizard/CreateDefinition.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/wizard/CreateDefinition.test.tsx
git commit -m "$(cat <<'EOF'
feat(wizard): disk-size input with validation + i18n

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: defio bundle import validation

**Files:**
- Modify: `src/main/defio/bundle.ts:55-56` (`normalizeEntry`)
- Test: `tests/main/defio/bundle.test.ts`

**Interfaces:**
- Consumes: `isValidDiskSize`, `parseDiskSize` (Task 1); `Definition.diskSize` (Task 2).
- Produces: import keeps a valid `diskSize`, drops an invalid one to `undefined`; export already carries the field (it rides along in the `definition` object).

- [ ] **Step 1: Write the failing tests**

Append to `tests/main/defio/bundle.test.ts` (match the file's existing helpers for building a bundle / calling `parseImportBundle` and `buildExportBundle`):

```ts
describe('bundle diskSize', () => {
  const entry = (diskSize: unknown) => JSON.stringify({
    formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 't',
    definitions: [{ definition: { name: 'n', baseImage: 'img', tier: 'locked', diskSize }, mounts: [], domains: [], ports: [], hostServices: [], credentials: [] }]
  })
  it('keeps a valid diskSize (normalized) on import', () => {
    const { definitions } = parseImportBundle(entry('40G'))
    expect(definitions[0].definition.diskSize).toBe('40g')
  })
  it('drops an invalid diskSize to undefined', () => {
    const { definitions } = parseImportBundle(entry('40gb'))
    expect(definitions[0].definition.diskSize).toBeUndefined()
  })
  it('export carries diskSize through', () => {
    const spec = {
      definition: { id: 'x', name: 'n', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't', diskSize: '30g' },
      mounts: [], domains: [], ports: [], hostServices: [], credentials: []
    }
    const bundle = buildExportBundle([spec], 't')
    expect(bundle.definitions[0].definition.diskSize).toBe('30g')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/defio/bundle.test.ts`
Expected: FAIL — `diskSize` is not read in `normalizeEntry` (comes back `undefined` for the valid case).

- [ ] **Step 3: Validate `diskSize` on import**

In `src/main/defio/bundle.ts`:

(a) Import (line 4) — add the two functions:

```ts
import { isValidMemory, parseMemory, isValidDiskSize, parseDiskSize } from '@shared/resources'
```

(b) In `normalizeEntry`, add to the returned `definition` object after the `memory` line (line 56):

```ts
      memory: typeof def.memory === 'string' && isValidMemory(def.memory) ? parseMemory(def.memory) : undefined,
      diskSize: typeof def.diskSize === 'string' && isValidDiskSize(def.diskSize) ? parseDiskSize(def.diskSize) : undefined
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/defio/bundle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/defio/bundle.ts tests/main/defio/bundle.test.ts
git commit -m "$(cat <<'EOF'
fix(defio): carry and validate diskSize on definition bundle import

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `launchCommand` env-var injection

**Files:**
- Modify: `src/main/sbx/translate.ts` (`launchCommand`)
- Test: `tests/main/sbx/translate.test.ts`

**Interfaces:**
- Consumes: nothing (receives an already-normalized size string).
- Produces: `launchCommand(spec, name?, sessionName?, kitDir?, ports?, diskSize?: string): string` — when `diskSize` is a non-empty string, the `sbx create` step is prefixed with `DOCKER_SANDBOXES_DOCKER_SIZE='<size>' `; otherwise unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/main/sbx/translate.test.ts` (uses the existing `spec()` and `launchCommand` already imported at the top):

```ts
describe('launchCommand disk size', () => {
  it('prefixes DOCKER_SANDBOXES_DOCKER_SIZE on the create step when a size is given', () => {
    const cmd = launchCommand(spec(), 'box', undefined, undefined, [], '20g')
    expect(cmd).toContain("DOCKER_SANDBOXES_DOCKER_SIZE='20g' sbx create")
  })
  it('omits the env var entirely when no size is given', () => {
    const cmd = launchCommand(spec(), 'box')
    expect(cmd).not.toContain('DOCKER_SANDBOXES_DOCKER_SIZE')
  })
  it('puts the prefix on create only, not on later steps', () => {
    const cmd = launchCommand(spec({ ports: [{ hostPort: 3000, containerPort: 8080, protocol: 'tcp', label: 'web' }] }), 'box', undefined, undefined, [{ hostPort: 3000, containerPort: 8080, protocol: 'tcp', label: 'web' }], '20g')
    // exactly one occurrence, immediately before `sbx create`
    expect(cmd.match(/DOCKER_SANDBOXES_DOCKER_SIZE/g)?.length).toBe(1)
    expect(cmd).toContain("DOCKER_SANDBOXES_DOCKER_SIZE='20g' sbx create")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/sbx/translate.test.ts`
Expected: FAIL — `launchCommand` ignores the 6th argument; the env var never appears.

- [ ] **Step 3: Add the parameter + prefix the create step**

In `src/main/sbx/translate.ts`, `launchCommand` (line 163). Add the `diskSize` param and build the create step with an optional env prefix:

```ts
export function launchCommand(spec: DefinitionSpec, name: string = resolveSandboxName(spec), sessionName?: string, kitDir?: string, ports: PortIntent[] = spec.ports, diskSize?: string): string {
  const createCmd = shellCommand(['sbx', ...specToCreateArgs(spec, name, kitDir)])
  // Disk/volume size has no sbx CLI flag — it is read from DOCKER_SANDBOXES_DOCKER_SIZE on
  // the create process. Inline env-var prefix scopes it to just `sbx create` (the only step
  // that provisions the volume), consistent with the `unset SSH_AUTH_SOCK` handling below.
  const create = diskSize && diskSize.trim() ? `DOCKER_SANDBOXES_DOCKER_SIZE=${shellQuote(diskSize.trim())} ${createCmd}` : createCmd
  const steps: string[] = [create]
```

> This replaces the current first line of the body (`const steps: string[] = [shellCommand(['sbx', ...specToCreateArgs(spec, name, kitDir)])]`). Everything after it is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/sbx/translate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/sbx/translate.ts tests/main/sbx/translate.test.ts
git commit -m "$(cat <<'EOF'
feat(sbx): inject DOCKER_SANDBOXES_DOCKER_SIZE on the create step

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `launchDefinition` threading + override resolution

**Files:**
- Modify: `src/main/launch.ts` (`launchDefinition`)
- Test: `tests/main/launch.test.ts`

**Interfaces:**
- Consumes: `parseDiskSize` (Task 1); `launchCommand(…, diskSize?)` (Task 6); `spec.definition.diskSize` (Task 2).
- Produces: `launchDefinition(deps, definitionId, requestedName?, sessionName?, opener?, rawTags?, diskSizeOverride?: string)` — effective size is `diskSizeOverride !== undefined ? parseDiskSize(diskSizeOverride) : spec.definition.diskSize`, passed to `launchCommand`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/main/launch.test.ts` (uses the existing `spec` and `deps` helpers at the top of the file):

```ts
describe('launchDefinition disk size', () => {
  it('injects the definition default disk size into the create step', async () => {
    const d = deps(() => ({ ...spec, definition: { ...spec.definition, diskSize: '30g' } }))
    await launchDefinition(d as never, 'd1')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain("DOCKER_SANDBOXES_DOCKER_SIZE='30g' sbx create")
  })
  it('an explicit override replaces the definition default for that run', async () => {
    const d = deps(() => ({ ...spec, definition: { ...spec.definition, diskSize: '30g' } }))
    await launchDefinition(d as never, 'd1', undefined, undefined, 'terminal', [], '8g')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).toContain("DOCKER_SANDBOXES_DOCKER_SIZE='8g' sbx create")
    expect(cmd).not.toContain("'30g'")
  })
  it('an empty override means Docker default (no env var)', async () => {
    const d = deps(() => ({ ...spec, definition: { ...spec.definition, diskSize: '30g' } }))
    await launchDefinition(d as never, 'd1', undefined, undefined, 'terminal', [], '')
    const cmd = d.openTerminal.mock.calls[0][0] as string
    expect(cmd).not.toContain('DOCKER_SANDBOXES_DOCKER_SIZE')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/launch.test.ts`
Expected: FAIL — `launchDefinition` ignores disk size; the env var never appears.

- [ ] **Step 3: Resolve + thread the effective size**

In `src/main/launch.ts`:

(a) Import `parseDiskSize` (add to the existing imports near the top):

```ts
import { parseDiskSize } from '@shared/resources'
```

(b) `launchDefinition` signature (lines 40-47) — add the override param after `rawTags`:

```ts
export async function launchDefinition(
  deps: LaunchDeps,
  definitionId: string,
  requestedName?: string,
  sessionName?: string,
  opener: 'terminal' | 'vscode' = 'terminal',
  rawTags: string[] = [],
  diskSizeOverride?: string
): Promise<{ name: string }> {
```

(c) Resolve the effective size and pass it to `launchCommand` (line 87). Replace that line with:

```ts
  const disk = diskSizeOverride !== undefined ? parseDiskSize(diskSizeOverride) : spec.definition.diskSize
  const command = launchCommand(spec, name, sessionName, kitDir, ports, disk)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/launch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/launch.ts tests/main/launch.test.ts
git commit -m "$(cat <<'EOF'
feat(launch): resolve effective disk size (override ?? definition default)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: IPC / preload / client threading

**Files:**
- Modify: `src/main/ipc.ts` (`instance:launch` type ~128, handler ~237, registration ~508)
- Modify: `src/preload/index.ts:16` (`instanceLaunch`)
- Modify: `src/renderer/ipc/client.ts:17` (`instanceLaunch` interface)
- Test: `tests/main/ipc-tags.test.ts`

**Interfaces:**
- Consumes: `launchDefinition(…, diskSizeOverride?)` (Task 7).
- Produces: `instance:launch(definitionId, name?, sessionName?, opener?, tags?, diskSize?: string)` end to end; `instance:rebuild` still passes no override (definition default preserved).

- [ ] **Step 1: Write the failing test**

Append to `tests/main/ipc-tags.test.ts` (reuse its `baseDeps` helper, but capture the terminal command):

```ts
describe('instance:launch disk size', () => {
  it('forwards the disk-size override into the create step', async () => {
    const store = openStore(':memory:')
    store.insertDefinitionSpec({
      definition: { id: 'd1', name: 'proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: new Date().toISOString(), diskSize: '30g' },
      mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    })
    const cmds: string[] = []
    const deps = { ...baseDeps(store), openTerminal: (c: string) => cmds.push(c) }
    const h = buildHandlers(deps)
    await h['instance:launch']('d1', undefined, undefined, 'terminal', [], '8g')
    expect(cmds[0]).toContain("DOCKER_SANDBOXES_DOCKER_SIZE='8g' sbx create")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/ipc-tags.test.ts`
Expected: FAIL — the handler drops the 6th argument, so the definition default `'30g'` (not `'8g'`) is used, or a type error surfaces.

- [ ] **Step 3: Thread `diskSize` through the IPC layers**

In `src/main/ipc.ts`:

(a) Handler type in the `buildHandlers` return type (line 128):

```ts
  'instance:launch': (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[], diskSize?: string) => Promise<Result<{ name: string }>>
```

(b) Handler implementation (line 237):

```ts
    'instance:launch': (definitionId, name, sessionName, opener, tags, diskSize) => wrap(() => launchDefinition(
      launchDeps(),
      definitionId, name, sessionName, opener ?? 'terminal', tags ?? [], diskSize
    )),
```

(c) `ipcMain.handle` registration (line 508):

```ts
  ipcMain.handle('instance:launch', (_e, id: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[], diskSize?: string) => handlers['instance:launch'](id, name, sessionName, opener, tags, diskSize))
```

In `src/preload/index.ts` (line 16):

```ts
  instanceLaunch: (definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[], diskSize?: string) => ipcRenderer.invoke('instance:launch', definitionId, name, sessionName, opener, tags, diskSize),
```

In `src/renderer/ipc/client.ts` (line 17):

```ts
  instanceLaunch(definitionId: string, name?: string, sessionName?: string, opener?: 'terminal' | 'vscode', tags?: string[], diskSize?: string): Promise<Result<{ name: string }>>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/ipc-tags.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc-tags.test.ts
git commit -m "$(cat <<'EOF'
feat(ipc): thread diskSize override through instance:launch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: LaunchDialog field + App wiring

**Files:**
- Modify: `src/renderer/components/LaunchDialog.tsx`
- Modify: `src/renderer/App.tsx` (`submitLaunch`, `onLaunch` prop wiring)
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts` (launch strings)
- Test: `tests/renderer/LaunchDialog.test.tsx`

**Interfaces:**
- Consumes: `isValidDiskSize` (Task 1); `Definition.diskSize` (Task 2); `api.instanceLaunch(…, diskSize)` (Task 8).
- Produces: `LaunchDialog.onLaunch(sessionName, opener, tags, diskSize)` — the disk field is pre-filled from `definition.diskSize ?? ''`, authoritative for that run.

> **Note — signature change is breaking for existing tests.** `onLaunch` gains a 4th argument, so the existing `LaunchDialog.test.tsx` assertions like `toHaveBeenCalledWith('', 'vscode', [])` must become `toHaveBeenCalledWith('', 'vscode', [], '')` (empty disk field by default). Update those existing assertions in the same task.

- [ ] **Step 1: Write/adjust the failing tests**

In `tests/renderer/LaunchDialog.test.tsx`:

(a) Update the existing `onLaunch` assertions to include the 4th arg (`''` when the disk field is untouched): lines 26, 34, 42, 68 — append `, ''` to each `toHaveBeenCalledWith(...)`. Example (line 26):

```ts
    expect(onLaunch).toHaveBeenCalledWith('', 'vscode', [], '')
```

(b) Add new tests:

```ts
describe('LaunchDialog disk size', () => {
  it('pre-fills the disk field from the definition default and passes it through', () => {
    const onLaunch = vi.fn()
    const withDisk: Definition = { ...def, diskSize: '30g' }
    render(<LaunchDialog definition={withDisk} hasVSCode={false} cloneMode={false} willSkipFixedPorts={false} instanceNumber={1} onLaunch={onLaunch} onCancel={() => {}} />)
    expect(screen.getByLabelText('Disk size')).toHaveValue('30g')
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    expect(onLaunch).toHaveBeenCalledWith('', 'terminal', [], '30g')
  })
  it('lets the user override the disk size for this run', () => {
    const onLaunch = vi.fn()
    const withDisk: Definition = { ...def, diskSize: '30g' }
    render(<LaunchDialog definition={withDisk} hasVSCode={false} cloneMode={false} willSkipFixedPorts={false} instanceNumber={1} onLaunch={onLaunch} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Disk size'), { target: { value: '8g' } })
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    expect(onLaunch).toHaveBeenCalledWith('', 'terminal', [], '8g')
  })
  it('shows an inline error on an invalid disk size', () => {
    render(<LaunchDialog definition={def} hasVSCode={false} cloneMode={false} willSkipFixedPorts={false} instanceNumber={1} onLaunch={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Disk size'), { target: { value: '8gb' } })
    expect(screen.getByText(/binary size like/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/LaunchDialog.test.tsx`
Expected: FAIL — no "Disk size" input; `onLaunch` still called with 3 args.

- [ ] **Step 3: Add the launch i18n keys (en + de)**

In `src/renderer/i18n/en.ts`, in the `launch` block after `tagsSub` (line 112):

```ts
    diskSizeLabel: 'Disk size (optional)',
    diskSizePlaceholder: '50g — Docker default',
    diskSizeInvalid: 'Use a binary size like 50g or 512m, or leave blank for the default.',
```

In `src/renderer/i18n/de.ts`, in the `launch` block after its `tagsSub` key:

```ts
    diskSizeLabel: 'Festplattengröße (optional)',
    diskSizePlaceholder: '50g — Docker-Standard',
    diskSizeInvalid: 'Binärgröße wie 50g oder 512m verwenden oder leer lassen für den Standard.',
```

- [ ] **Step 4: Add the field to `LaunchDialog`**

In `src/renderer/components/LaunchDialog.tsx`:

(a) Import `isValidDiskSize`:

```ts
import { isValidDiskSize } from '@shared/resources'
```

(b) `onLaunch` prop type (line 20) — add the 4th arg:

```ts
  onLaunch: (sessionName: string, opener: 'terminal' | 'vscode', tags: string[], diskSize: string) => void
```

(c) State, seeded from the definition (after line 28's `tags` state):

```ts
  const [diskSize, setDiskSize] = useState(definition.diskSize ?? '')
```

(d) `submit` (line 30-32):

```ts
  function submit(): void {
    onLaunch(sessionName.trim(), opener, tags, diskSize.trim())
  }
```

(e) Add the input to the form — place it after the tags block (after line 55's `tagsSub` paragraph), before the port-skip note:

```tsx
        <label htmlFor="launch-disk-size" style={labelStyle}>{t('launch.diskSizeLabel')}</label>
        <input
          id="launch-disk-size"
          aria-label="Disk size"
          className="input"
          value={diskSize}
          placeholder={t('launch.diskSizePlaceholder')}
          onChange={(e) => setDiskSize(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && isValidDiskSize(diskSize)) submit() }}
        />
        {!isValidDiskSize(diskSize) && <p role="alert" className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-2)', marginBottom: 0, color: 'var(--danger)' }}>{t('launch.diskSizeInvalid')}</p>}
```

- [ ] **Step 5: Thread the value through `App.tsx`**

In `src/renderer/App.tsx`:

(a) `submitLaunch` signature (line 147) — add `diskSize`:

```ts
  async function submitLaunch(definition: Definition, sessionName: string, opener: 'terminal' | 'vscode', tags: string[], diskSize: string): Promise<void> {
```

(b) The `api.instanceLaunch` call (line 152) — pass `diskSize`:

```ts
      const r = await api.instanceLaunch(definition.id, undefined, sessionName, opener, tags, diskSize)
```

(c) The `onLaunch` wiring (line 293):

```tsx
            onLaunch={(session, opener, tags, diskSize) => void submitLaunch(launchFor, session, opener, tags, diskSize)}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/LaunchDialog.test.tsx tests/renderer/i18n.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/LaunchDialog.tsx src/renderer/App.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/LaunchDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(launch): disk-size field in the Launch dialog (pre-filled, per-run override)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Catches any missed signature update across preload/client/ipc.)

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green. If `tests/main/**` fails on the better-sqlite3 native module, close any running instance of the app and re-run (see Global Constraints).

- [ ] **Step 3: Manual smoke (optional but recommended)**

Use the `run` skill (or `npm run dev`) to launch the app; create a definition with disk size `20g`, open the Launch dialog (field shows `20g`), change to `8g`, launch with the Terminal opener, and confirm the opened command begins with `DOCKER_SANDBOXES_DOCKER_SIZE='8g' sbx create …`.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch to integrate.

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- Mechanism (env var on create step) → Task 6.
- Definition type / validator / store / wizard / draft / defio → Tasks 1–5.
- Launch-time override (dialog → preload → IPC → launchDefinition → launchCommand) → Tasks 7–9.
- `instance:rebuild` uses the definition default → Task 8 (no override passed; verified in existing rebuild test, unchanged behavior).
- Out-of-scope items (`adapter.createSandbox`, live resize) → intentionally untouched.
- Testing list in the spec → covered by the per-task tests + Task 10.

**2. Placeholder scan** — no TBD/TODO; every code step has real code. The only soft spot is the wizard test's `renderWizardOnStep(2)` helper (Task 4 Step 1), which defers to the file's existing step-2 navigation because that harness detail isn't visible in this plan; the note tells the implementer exactly what to do.

**3. Type consistency** — `diskSize?: string` (Definition), `Draft.diskSize: string`, `parseDiskSize`/`isValidDiskSize` names, `launchCommand(…, diskSize?)` 6th param, `launchDefinition(…, diskSizeOverride?)` 7th param, and the `instance:launch(…, diskSize?)` 6th arg are used consistently across Tasks 1–9. The env-var string `DOCKER_SANDBOXES_DOCKER_SIZE` and the quoted form `DOCKER_SANDBOXES_DOCKER_SIZE='<size>'` match between Task 6's implementation and the assertions in Tasks 6–8.
