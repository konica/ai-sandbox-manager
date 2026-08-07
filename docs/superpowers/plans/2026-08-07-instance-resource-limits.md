# Per-Definition CPU & Memory Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set optional CPU (`--cpus`) and memory (`-m`) limits on a Definition; blank means omit the flag so `sbx` applies its own defaults.

**Architecture:** Two optional fields (`cpus?: number`, `memory?: string`) live on the persisted `Definition`, mirroring `baseImage`/`tier`. A shared validator/parser module keeps the wizard and the spec conversion in agreement. `specToCreateArgs` emits the flags when set. Because launch reads the definition via `getDefinitionSpec` and the interactive terminal path already delegates to `specToCreateArgs`, both create paths pick this up from one place. Limits are create-time only — the CLI has no in-place resize.

**Tech Stack:** TypeScript, Electron (main + renderer), better-sqlite3, React (wizard), Vitest + Testing Library.

## Global Constraints

- Node `>=26.0.0 <27.0.0`; ESM (`"type": "module"`); path aliases `@shared/*`, `@main/*`.
- `sbx` resource flags (v0.35.0): `--cpus int` (0 = auto/all CPUs), `-m/--memory string` in binary units like `1024m`, `8g` (default 50% host RAM, max 32 GiB). These exist only on `create`/`run`; there is no in-place resize command.
- `undefined`/absent limit → **omit the flag entirely** (never `--cpus 0` or `-m ""`).
- Migrations are non-destructive `ALTER TABLE ... ADD COLUMN`; existing rows read back as `NULL` → treated as absent.
- Run `npm run typecheck` and `npm test` before claiming completion (per CLAUDE.md).
- better-sqlite3 note: named/positional params reject JS `undefined` — always coerce to `null` before `.run()`.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/shared/types.ts` | Add `cpus?`/`memory?` to `Definition` | 1 |
| `src/shared/resources.ts` (new) | `isValidCpus`/`isValidMemory` + `parseCpus`/`parseMemory` | 1 |
| `tests/shared/resources.test.ts` (new) | Validator/parser unit tests | 1 |
| `src/main/sbx/translate.ts` | `specToCreateArgs` emits `--cpus`/`-m` | 2 |
| `tests/main/sbx/translate-resources.test.ts` (new) | Argv emission tests | 2 |
| `src/main/store/db.ts` | Migration + persist/read `cpus`/`memory` | 3 |
| `tests/main/store/db.test.ts` | Persistence round-trip tests | 3 |
| `src/renderer/wizard/draft.ts` | Draft fields, reducer, `toSpec`/`draftFromSpec`, `canAdvance` | 4 |
| `tests/renderer/wizard/draft.test.ts` | Draft/spec mapping + gating tests | 4 |
| `src/renderer/wizard/CreateDefinition.tsx` | Inputs, inline errors, submit guard, behavioral note | 5 |
| `src/renderer/i18n/en.ts`, `de.ts` | Wizard copy for the new fields | 5 |
| `tests/renderer/wizard/CreateDefinition.test.tsx` | Invalid input surfaces error | 5 |

---

### Task 1: Definition fields + shared validators/parsers

**Files:**
- Modify: `src/shared/types.ts` (the `Definition` interface, ~lines 15-23)
- Create: `src/shared/resources.ts`
- Test: `tests/shared/resources.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Definition.cpus?: number`, `Definition.memory?: string`
  - `isValidCpus(s: string): boolean`
  - `isValidMemory(s: string): boolean`
  - `parseCpus(s: string): number | undefined`
  - `parseMemory(s: string): string | undefined`

- [ ] **Step 1: Write the failing test**

Create `tests/shared/resources.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isValidCpus, isValidMemory, parseCpus, parseMemory } from '@shared/resources'

describe('isValidCpus', () => {
  it('accepts empty (= sbx default) and positive integers', () => {
    for (const s of ['', '  ', '1', '4', '16']) expect(isValidCpus(s)).toBe(true)
  })
  it('rejects zero, negatives, decimals, and non-numbers', () => {
    for (const s of ['0', '-1', '2.5', 'abc', '4 cpus']) expect(isValidCpus(s)).toBe(false)
  })
})

describe('isValidMemory', () => {
  it('accepts empty and binary-unit sizes', () => {
    for (const s of ['', '1024m', '8g', '512M', '2G', '1.5g']) expect(isValidMemory(s)).toBe(true)
  })
  it('rejects unitless numbers and junk', () => {
    for (const s of ['1024', '8gb', 'g', 'abc', '8 g x']) expect(isValidMemory(s)).toBe(false)
  })
})

describe('parseCpus', () => {
  it('returns the integer when valid, undefined otherwise', () => {
    expect(parseCpus('4')).toBe(4)
    expect(parseCpus('')).toBeUndefined()
    expect(parseCpus('0')).toBeUndefined()
    expect(parseCpus('2.5')).toBeUndefined()
  })
})

describe('parseMemory', () => {
  it('normalizes unit to lowercase and strips spaces, else undefined', () => {
    expect(parseMemory('8G')).toBe('8g')
    expect(parseMemory('1024 m')).toBe('1024m')
    expect(parseMemory('')).toBeUndefined()
    expect(parseMemory('1024')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/resources.test.ts`
Expected: FAIL — cannot resolve `@shared/resources`.

- [ ] **Step 3: Write the module and extend the type**

Create `src/shared/resources.ts`:

```typescript
// CPU/memory limit input validation + parsing, shared by the wizard (inline
// errors, advance-gating) and toSpec so both agree on what "valid" means.
// Mirrors sbx v0.35.0: --cpus is a positive integer; -m is a binary-unit size
// (e.g. 1024m, 8g). Empty always means "omit the flag" → sbx applies its default.

const CPUS_RE = /^\d+$/
const MEMORY_RE = /^\d+(\.\d+)?\s*[mMgG]$/

/** Empty (= use sbx default) or a positive integer CPU count. */
export function isValidCpus(s: string): boolean {
  const t = s.trim()
  if (t === '') return true
  return CPUS_RE.test(t) && Number(t) >= 1
}

/** Empty (= use sbx default) or a binary-unit size like `1024m` / `8g`. */
export function isValidMemory(s: string): boolean {
  const t = s.trim()
  if (t === '') return true
  return MEMORY_RE.test(t)
}

/** Validated cpus input → positive integer, or undefined when blank/invalid. */
export function parseCpus(s: string): number | undefined {
  const t = s.trim()
  if (!CPUS_RE.test(t)) return undefined
  const n = Number(t)
  return n >= 1 ? n : undefined
}

/** Validated memory input → normalized (lowercase unit, no spaces), or undefined when blank/invalid. */
export function parseMemory(s: string): string | undefined {
  const t = s.trim()
  if (!MEMORY_RE.test(t)) return undefined
  return t.replace(/\s+/g, '').toLowerCase()
}
```

In `src/shared/types.ts`, extend the `Definition` interface (add the two fields after `tier`):

```typescript
export interface Definition {
  id: string
  name: string
  description: string
  baseImage: string
  agent: AgentId
  tier: Tier
  createdAt: string
  cpus?: number // optional CPU count; absent → sbx default (all host CPUs)
  memory?: string // optional binary-unit memory limit (e.g. '8g'); absent → sbx default
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/resources.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/shared/resources.ts src/shared/types.ts tests/shared/resources.test.ts
git commit -m "feat(resources): Definition cpus/memory fields + shared validators"
```

---

### Task 2: Emit `--cpus` / `-m` from specToCreateArgs

**Files:**
- Modify: `src/main/sbx/translate.ts` (`specToCreateArgs`, ~lines 92-101)
- Test: `tests/main/sbx/translate-resources.test.ts`

**Interfaces:**
- Consumes: `Definition.cpus?`, `Definition.memory?` (Task 1); existing `specToCreateArgs(spec, name?, kitDir?)`.
- Produces: no new signatures — behavior only.

- [ ] **Step 1: Write the failing test**

Create `tests/main/sbx/translate-resources.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { specToCreateArgs } from '../../../src/main/sbx/translate'
import type { DefinitionSpec } from '@shared/types'

function spec(over: Partial<DefinitionSpec['definition']> = {}): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'proj', description: '', baseImage: '', agent: 'claude', tier: 'open', createdAt: '', ...over },
    mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
    domains: [], ports: [], hostServices: [], credentials: []
  }
}

describe('specToCreateArgs resource limits', () => {
  it('omits both flags when cpus/memory are unset', () => {
    const args = specToCreateArgs(spec())
    expect(args).not.toContain('--cpus')
    expect(args).not.toContain('-m')
  })

  it('appends --cpus when a positive integer is set', () => {
    const args = specToCreateArgs(spec({ cpus: 4 }))
    expect(args.join(' ')).toContain('--cpus 4')
  })

  it('appends -m when memory is set', () => {
    const args = specToCreateArgs(spec({ memory: '8g' }))
    expect(args.join(' ')).toContain('-m 8g')
  })

  it('omits --cpus when cpus is 0', () => {
    const args = specToCreateArgs(spec({ cpus: 0 }))
    expect(args).not.toContain('--cpus')
  })

  it('appends both when both set', () => {
    const args = specToCreateArgs(spec({ cpus: 2, memory: '1024m' }))
    const s = args.join(' ')
    expect(s).toContain('--cpus 2')
    expect(s).toContain('-m 1024m')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/sbx/translate-resources.test.ts`
Expected: FAIL — flags are not emitted yet.

- [ ] **Step 3: Add the emission to specToCreateArgs**

In `src/main/sbx/translate.ts`, inside `specToCreateArgs`, insert the two lines immediately before `return args`:

```typescript
  if (kitDir) args.push('--kit', kitDir)
  const { cpus, memory } = spec.definition
  if (typeof cpus === 'number' && cpus >= 1) args.push('--cpus', String(cpus))
  if (memory && memory.trim().length > 0) args.push('-m', memory.trim())
  return args
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/sbx/translate-resources.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Run the neighboring translate suite (no regressions)**

Run: `npx vitest run tests/main/sbx/translate-port-skip.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/sbx/translate.ts tests/main/sbx/translate-resources.test.ts
git commit -m "feat(sbx): emit --cpus/-m from specToCreateArgs when set"
```

---

### Task 3: Persist and read cpus/memory (DB)

**Files:**
- Modify: `src/main/store/db.ts` (migration block ~lines 137-162; `insertDefinition` ~205; `listDefinitions` ~211; `getDefinition` ~214; `insertDefinitionSpec` ~218; `updateDefinitionSpec` ~230; `getDefinitionSpec` ~243)
- Test: `tests/main/store/db.test.ts`

**Interfaces:**
- Consumes: `Definition.cpus?`, `Definition.memory?` (Task 1).
- Produces: `insertDefinitionSpec`/`updateDefinitionSpec` persist both; `getDefinitionSpec`/`getDefinition`/`listDefinitions` return them (`undefined` when `NULL`).

- [ ] **Step 1: Write the failing test**

Append to `tests/main/store/db.test.ts` (inside the top-level `describe('metadata-store', ...)`):

```typescript
  it('persists and reads cpus/memory on a definition spec', () => {
    const base = {
      definition: { id: 'r1', name: 'r', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't', cpus: 4, memory: '8g' },
      mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }],
      domains: [], ports: [], hostServices: [], credentials: []
    }
    store.insertDefinitionSpec(base)
    const got = store.getDefinitionSpec('r1')
    expect(got?.definition.cpus).toBe(4)
    expect(got?.definition.memory).toBe('8g')

    store.updateDefinitionSpec({ ...base, definition: { ...base.definition, cpus: 2, memory: '1024m' } })
    const updated = store.getDefinitionSpec('r1')
    expect(updated?.definition.cpus).toBe(2)
    expect(updated?.definition.memory).toBe('1024m')
  })

  it('reads cpus/memory back as undefined when never set', () => {
    const base = {
      definition: { id: 'r2', name: 'r2', description: '', agent: 'claude' as const, baseImage: 'img', tier: 'locked' as const, createdAt: 't' },
      mounts: [{ hostPath: '/w', mode: 'direct' as const, isPrimary: true }],
      domains: [], ports: [], hostServices: [], credentials: []
    }
    store.insertDefinitionSpec(base)
    const got = store.getDefinitionSpec('r2')
    expect(got?.definition.cpus).toBeUndefined()
    expect(got?.definition.memory).toBeUndefined()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/store/db.test.ts`
Expected: FAIL — `cpus`/`memory` are not persisted/returned.

- [ ] **Step 3a: Add the migration**

In `src/main/store/db.ts`, after the `kit_commands_yaml` / `agent` definition migrations (the block using `defCols`, ~line 162), add:

```typescript
  // v10 → v11: definitions gain optional CPU/memory limits (create-time only).
  // Non-destructive; existing rows stay NULL → the flag is omitted at create and
  // sbx applies its own defaults.
  if (!defCols.includes('cpus')) {
    db.exec(`ALTER TABLE definition ADD COLUMN cpus INTEGER;`)
    db.exec(`ALTER TABLE definition ADD COLUMN memory TEXT;`)
  }
```

- [ ] **Step 3b: Persist on the spec insert/update**

In `insertDefinitionSpec`, extend the definition INSERT to carry the two columns:

```typescript
        db.prepare(
          `INSERT INTO definition (id, name, description, base_image, agent, tier, created_at, ssh_forward_agent, ssh_commit_signing, kit_commands_yaml, cpus, memory)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(s.definition.id, s.definition.name, s.definition.description, s.definition.baseImage, s.definition.agent, s.definition.tier, s.definition.createdAt,
          ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null, s.definition.cpus ?? null, s.definition.memory ?? null)
```

In `updateDefinitionSpec`, extend the UPDATE:

```typescript
        const res = db.prepare(
          `UPDATE definition SET name = ?, description = ?, base_image = ?, agent = ?, tier = ?, ssh_forward_agent = ?, ssh_commit_signing = ?, kit_commands_yaml = ?, cpus = ?, memory = ? WHERE id = ?`
        ).run(s.definition.name, s.definition.description, s.definition.baseImage, s.definition.agent, s.definition.tier,
          ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null, s.definition.cpus ?? null, s.definition.memory ?? null, s.definition.id)
```

- [ ] **Step 3c: Read on the spec/definition selects**

Add a shared coercion helper near the top of the returned store object's scope (module-level function in `db.ts`), then use it. Add this function alongside the other private helpers (e.g. just above `insertChildren`):

```typescript
  // NULL columns come back as JS null; the Definition type uses optional (undefined).
  function defWithLimits(row: Record<string, unknown>): Definition {
    return {
      id: String(row.id), name: String(row.name), description: String(row.description),
      baseImage: String(row.baseImage), agent: row.agent as Definition['agent'], tier: row.tier as Definition['tier'],
      createdAt: String(row.createdAt),
      cpus: row.cpus == null ? undefined : Number(row.cpus),
      memory: row.memory == null ? undefined : String(row.memory)
    }
  }
```

Update the three definition SELECTs to fetch `cpus, memory` and route through the helper:

`listDefinitions`:
```typescript
    listDefinitions() {
      const rows = db.prepare(`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt, cpus, memory FROM definition ORDER BY created_at DESC`).all() as Array<Record<string, unknown>>
      return rows.map(defWithLimits)
    },
```

`getDefinition`:
```typescript
    getDefinition(id) {
      const row = db.prepare(`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt, cpus, memory FROM definition WHERE id = ?`).get(id) as Record<string, unknown> | undefined
      return row ? defWithLimits(row) : null
    },
```

`getDefinitionSpec` (the `def` line, ~244):
```typescript
      const row = db.prepare(`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt, cpus, memory FROM definition WHERE id = ?`).get(id) as Record<string, unknown> | undefined
      if (!row) return null
      const def = defWithLimits(row)
```

(Keep the rest of `getDefinitionSpec` unchanged — it already references `def` for `spec.definition`.)

- [ ] **Step 3d: Carry columns on the plain `insertDefinition`**

`insertDefinition` runs `.run(d)` with named params; `undefined` would throw, so coerce:

```typescript
    insertDefinition(d) {
      db.prepare(
        `INSERT INTO definition (id, name, description, base_image, agent, tier, created_at, cpus, memory)
         VALUES (@id, @name, @description, @baseImage, @agent, @tier, @createdAt, @cpus, @memory)`
      ).run({ ...d, cpus: d.cpus ?? null, memory: d.memory ?? null })
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/store/db.test.ts`
Expected: PASS (new cases + existing round-trip/kit cases still green).

- [ ] **Step 5: Commit**

```bash
git add src/main/store/db.ts tests/main/store/db.test.ts
git commit -m "feat(store): persist and read Definition cpus/memory"
```

---

### Task 4: Wizard draft — fields, mapping, and advance-gating

**Files:**
- Modify: `src/renderer/wizard/draft.ts` (`Draft` ~56-74, `initialDraft` ~76-94, `DraftAction` setField union ~100, `canAdvance` ~189-195, `draftFromSpec` ~207-234, `toSpec` ~236-255)
- Test: `tests/renderer/wizard/draft.test.ts`

**Interfaces:**
- Consumes: `parseCpus`, `parseMemory`, `isValidCpus`, `isValidMemory` (Task 1); `Definition.cpus?`, `memory?`.
- Produces:
  - `Draft.cpus: string`, `Draft.memory: string`
  - `setField` accepts `'cpus' | 'memory'`
  - `toSpec` writes `definition.cpus`/`memory` (undefined when blank/invalid)
  - `draftFromSpec` seeds `cpus`/`memory` strings
  - `canAdvance` step 2 also requires valid cpus & memory

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/wizard/draft.test.ts`:

```typescript
import { toSpec, draftFromSpec, initialDraft, draftReducer, canAdvance } from '@renderer/wizard/draft'

describe('draft resource limits', () => {
  it('toSpec parses cpus/memory into the definition, undefined when blank', () => {
    const set = toSpec({ ...initialDraft, workspace: '/w', cpus: '4', memory: '8G' }, 'id1', 't')
    expect(set.definition.cpus).toBe(4)
    expect(set.definition.memory).toBe('8g')

    const blank = toSpec({ ...initialDraft, workspace: '/w' }, 'id2', 't')
    expect(blank.definition.cpus).toBeUndefined()
    expect(blank.definition.memory).toBeUndefined()
  })

  it('draftFromSpec seeds cpus/memory strings (and empty when absent)', () => {
    const withLimits = draftFromSpec(toSpec({ ...initialDraft, workspace: '/w', cpus: '2', memory: '1024m' }, 'id3', 't'))
    expect(withLimits.cpus).toBe('2')
    expect(withLimits.memory).toBe('1024m')

    const without = draftFromSpec(toSpec({ ...initialDraft, workspace: '/w' }, 'id4', 't'))
    expect(without.cpus).toBe('')
    expect(without.memory).toBe('')
  })

  it('setField updates cpus and memory', () => {
    let d = draftReducer(initialDraft, { type: 'setField', field: 'cpus', value: '8' })
    d = draftReducer(d, { type: 'setField', field: 'memory', value: '16g' })
    expect(d.cpus).toBe('8')
    expect(d.memory).toBe('16g')
  })

  it('canAdvance blocks step 2 on invalid cpus/memory', () => {
    const onImage = { ...initialDraft, step: 2, workspace: '/w', imageChoice: 'claude-code' as const }
    expect(canAdvance(onImage)).toBe(true)
    expect(canAdvance({ ...onImage, cpus: 'abc' })).toBe(false)
    expect(canAdvance({ ...onImage, memory: '8gb' })).toBe(false)
  })
})
```

(If `@renderer` is not an existing alias in this test file, use the relative import already used by the other cases in the file. Check the file's existing import style and match it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/wizard/draft.test.ts`
Expected: FAIL — `cpus`/`memory` not on Draft; `canAdvance` doesn't gate.

- [ ] **Step 3a: Add fields + reducer + gating**

In `src/renderer/wizard/draft.ts`:

Add the import at the top:
```typescript
import { parseCpus, parseMemory, isValidCpus, isValidMemory } from '@shared/resources'
```

Extend the `Draft` interface (after `kitCommandsYaml`):
```typescript
  kitCommandsYaml: string
  cpus: string // optional CPU count as typed; '' = omit → sbx default
  memory: string // optional memory limit as typed (e.g. '8g'); '' = omit → sbx default
```

Extend `initialDraft` (after `kitCommandsYaml: ''`):
```typescript
  kitCommandsYaml: '',
  cpus: '',
  memory: ''
```

Widen the `setField` action union to include the two fields:
```typescript
  | { type: 'setField'; field: 'name' | 'description' | 'customImageRef' | 'workspace' | 'kitCommandsYaml' | 'cpus' | 'memory'; value: string }
```

(The reducer's existing `setField` default branch `return { ...d, [a.field]: a.value }` already handles `cpus`/`memory` — no new case needed.)

Extend `canAdvance` step 2:
```typescript
  if (d.step === 2) return resolveBaseImage(d).length > 0 && isValidCpus(d.cpus) && isValidMemory(d.memory)
```

- [ ] **Step 3b: Map in toSpec and draftFromSpec**

In `toSpec`, extend the `definition` object literal:
```typescript
    definition: { id, name: effectiveName(d), description: d.description.trim(), agent: d.agent, baseImage: resolveBaseImage(d), tier: d.tier, createdAt, cpus: parseCpus(d.cpus), memory: parseMemory(d.memory) },
```

In `draftFromSpec`, add to the returned object (after `kitCommandsYaml`):
```typescript
    kitCommandsYaml: spec.kitCommandsYaml ?? '',
    cpus: spec.definition.cpus != null ? String(spec.definition.cpus) : '',
    memory: spec.definition.memory ?? ''
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/wizard/draft.test.ts`
Expected: PASS (new + existing draft cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/wizard/draft.ts tests/renderer/wizard/draft.test.ts
git commit -m "feat(wizard): draft cpus/memory fields, mapping, and step-2 gating"
```

---

### Task 5: Wizard UI — inputs, inline errors, submit guard, i18n

**Files:**
- Modify: `src/renderer/wizard/CreateDefinition.tsx` (step 2 block ~295-313; `submit()` guards ~135-137)
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts` (the `wizard` object)
- Test: `tests/renderer/wizard/CreateDefinition.test.tsx`

**Interfaces:**
- Consumes: `Draft.cpus`/`memory`, `isValidCpus`/`isValidMemory` (Tasks 1, 4); `canAdvance` (already gates the Next button, Task 4).
- Produces: no new exported signatures — UI + copy only.

- [ ] **Step 1: Add i18n keys**

In `src/renderer/i18n/en.ts`, inside the `wizard: { ... }` object, add:
```typescript
    cpusLabel: 'CPUs (optional)',
    cpusPlaceholder: 'auto — all host CPUs',
    cpusInvalid: 'Enter a positive whole number, or leave blank for the default.',
    memoryLabel: 'Memory (optional)',
    memoryPlaceholder: '50% of host RAM (e.g. 8g, 1024m)',
    memoryInvalid: 'Use a binary size like 8g or 1024m, or leave blank for the default.',
    resourcesNote: 'Applied when the sandbox is created. Changing these updates future launches only — existing sandboxes keep the limits they were created with.',
```

Mirror the same keys in `src/renderer/i18n/de.ts` (translate the copy; keep the key names identical). Suggested German:
```typescript
    cpusLabel: 'CPUs (optional)',
    cpusPlaceholder: 'automatisch — alle Host-CPUs',
    cpusInvalid: 'Positive Ganzzahl eingeben oder leer lassen für den Standard.',
    memoryLabel: 'Arbeitsspeicher (optional)',
    memoryPlaceholder: '50% des Host-RAM (z. B. 8g, 1024m)',
    memoryInvalid: 'Binärgröße wie 8g oder 1024m verwenden oder leer lassen für den Standard.',
    resourcesNote: 'Wird beim Erstellen der Sandbox angewendet. Änderungen gelten nur für künftige Starts — bestehende Sandboxes behalten ihre ursprünglichen Limits.',
```

- [ ] **Step 2: Add the inputs to step 2**

In `src/renderer/wizard/CreateDefinition.tsx`, import the validators at the top:
```typescript
import { isValidCpus, isValidMemory } from '@shared/resources'
```

Inside the `draft.step === 2` block, after the base-image/agent selection and before the block closes, add the two inputs with inline errors. Match the existing label/input classes used elsewhere in the file (`labelStyle` pattern, `className="input"`):

```tsx
              <label htmlFor="def-cpus" style={labelStyle}>{t('wizard.cpusLabel')}</label>
              <input
                id="def-cpus"
                aria-label="CPUs"
                className="input input-mono"
                inputMode="numeric"
                placeholder={t('wizard.cpusPlaceholder')}
                value={draft.cpus}
                onChange={(e) => dispatch({ type: 'setField', field: 'cpus', value: e.target.value })}
              />
              {!isValidCpus(draft.cpus) && <div className="field-error" role="alert">{t('wizard.cpusInvalid')}</div>}

              <label htmlFor="def-memory" style={labelStyle}>{t('wizard.memoryLabel')}</label>
              <input
                id="def-memory"
                aria-label="Memory"
                className="input input-mono"
                placeholder={t('wizard.memoryPlaceholder')}
                value={draft.memory}
                onChange={(e) => dispatch({ type: 'setField', field: 'memory', value: e.target.value })}
              />
              {!isValidMemory(draft.memory) && <div className="field-error" role="alert">{t('wizard.memoryInvalid')}</div>}

              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>{t('wizard.resourcesNote')}</div>
```

(If the file has no `labelStyle`/`field-error` convention, reuse whatever label + error styling the surrounding step-2 markup already uses — do not introduce a new pattern. The exact class names matter less than matching the file.)

- [ ] **Step 3: Guard submit() for the edit-mode jump path**

In edit mode the user can jump straight to Review and Save, bypassing step-2's `canAdvance`. Add a guard in `submit()` alongside the existing workspace/kit guards (~lines 135-137):

```typescript
    if (!isValidCpus(draft.cpus) || !isValidMemory(draft.memory)) { dispatch({ type: 'goToStep', step: 2 }); setError(t('wizard.cpusInvalid')); return false }
```

(Place it after the workspace guard and before the kit guard, matching the existing `setError` + `goToStep` shape. If `setError` is named differently in this file, use the file's existing error-setter.)

- [ ] **Step 4: Write the test**

Append to `tests/renderer/wizard/CreateDefinition.test.tsx` a case that navigates to step 2 and asserts an invalid memory surfaces the error and blocks Next. Match the file's existing render/navigation helpers (reuse how other tests advance to a step and query text):

```tsx
it('shows an error and blocks Next when memory is invalid', async () => {
  // Render the wizard and advance to the Base Image step (step 2) using the
  // same helper the other tests in this file use to reach a given step.
  const { user } = renderWizardAtStep(2) // <-- use the file's actual helper/setup
  const memory = screen.getByLabelText('Memory')
  await user.clear(memory)
  await user.type(memory, '8gb') // invalid: sbx wants 8g / 1024m
  expect(screen.getByText(/binary size like 8g/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
})
```

If the file has no reusable step-2 helper, follow the setup an existing test in the same file uses (render `<CreateDefinition ... />`, click through to step 2), then perform the assertions above.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/wizard/CreateDefinition.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full typecheck + test sweep**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/wizard/CreateDefinition.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/wizard/CreateDefinition.test.tsx
git commit -m "feat(wizard): CPU/memory inputs with validation, hints, and behavioral note"
```

---

## Self-Review

**Spec coverage:**
- Data model (`cpus?`/`memory?` on `Definition`, DB columns) → Tasks 1, 3. ✓
- Argv translation (`--cpus`/`-m`, omit when unset, single code path via `specToCreateArgs`) → Task 2. ✓
- UI in wizard not launch dialog; draft plumbing; placeholders/hints → Tasks 4, 5. ✓
- Validation (shared predicates, inline errors, advance-gating, blank valid, no client-side 32 GiB cap) → Tasks 1, 4, 5. ✓
- Behavioral note (future launches only) → Task 5 (`resourcesNote`). ✓
- Testing (translate, validators, draft, db) → Tasks 1-5. ✓
- Out of scope (in-place resize, per-launch override, swap/pids/gpu, presets) → not implemented, correct. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real content. The two "match the file's existing helper/convention" notes in Task 5 are deliberate (test harness + CSS class names are file-specific) and each carries a concrete fallback. ✓

**Type consistency:** `isValidCpus`/`isValidMemory`/`parseCpus`/`parseMemory` names identical across Tasks 1, 2, 4, 5. `Definition.cpus?: number` / `memory?: string` consistent in types, translate, db, draft. `Draft.cpus: string` / `memory: string` consistent in draft + UI. DB columns `cpus INTEGER` / `memory TEXT` consistent across migration, insert, update, select. ✓
