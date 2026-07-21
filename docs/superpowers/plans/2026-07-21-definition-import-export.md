# Import / Export Sandbox Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export selected sandbox definitions to a secret-free `.sbx.json` bundle and import such a file (as new copies), with the v11 definition-list UI.

**Architecture:** A pure bundle core (`buildExportBundle`/`parseImportBundle`/`dedupeName`), two IPC handlers (`def:export`/`def:import`) using injected native Save/Open-file deps + a uuid generator, and renderer changes to the Definitions list (selection, toolbar, selection bar, flash).

**Tech Stack:** Electron (main/preload/renderer), electron-vite, React 18 + TS strict, better-sqlite3, Vitest + @testing-library/react. Only the main process touches `dialog`/`fs`.

## Global Constraints

- **Run tests with `npm test`** (the pretest hook flips the better-sqlite3 ABI); never bare `npx vitest`.
- **Secret-free by construction:** the exported bundle is `DefinitionSpec`s minus `definition.id`/`createdAt`. `CredentialRef`s carry no values, so no secret ever leaves — do NOT add any value lookup to export.
- **Import = new copy:** fresh `id` (uuid) + `createdAt`; name collision → `" (imported)"`, `" (imported 2)"`, … Never overwrite.
- **Format:** `{ formatVersion: '1', kind: 'sandbox-definitions', exportedAt, definitions: [...] }`. Validate `formatVersion`/`kind`/shape on import.
- **File I/O in main only** via injected `saveFile`/`openFile` deps (native dialogs) — keeps `ipc.ts` testable.
- **i18n parity:** every new `definitions.*` key in BOTH `en.ts` and `de.ts`.
- Branch: `phase-22-def-import-export` (already created off `main`).

---

### Task 1: Bundle core (build / parse / dedupe)

**Files:**
- Create: `src/main/defio/bundle.ts`
- Test: `tests/main/defio/bundle.test.ts`

**Interfaces:**
- Consumes: `DefinitionSpec` from `@shared/types`.
- Produces:
  ```ts
  export type ExportableDefinition = Omit<DefinitionSpec, 'definition'> & { definition: Omit<DefinitionSpec['definition'], 'id' | 'createdAt'> }
  export interface DefinitionBundle { formatVersion: '1'; kind: 'sandbox-definitions'; exportedAt: string; definitions: ExportableDefinition[] }
  export class BundleError extends Error {}
  export function buildExportBundle(specs: DefinitionSpec[], now: string): DefinitionBundle
  export function parseImportBundle(jsonText: string): { definitions: ExportableDefinition[]; skipped: number }
  export function dedupeName(name: string, existing: Set<string>): string
  ```
- Consumed by: Task 2.

- [ ] **Step 1: Write the failing test**

Create `tests/main/defio/bundle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildExportBundle, parseImportBundle, dedupeName, BundleError } from '../../../src/main/defio/bundle'
import type { DefinitionSpec } from '../../../src/shared/types'

const spec = (id: string, name: string): DefinitionSpec => ({
  definition: { id, name, description: 'd', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: ['api.example.com'],
  ports: [{ hostPort: 3000, containerPort: 8080, protocol: 'tcp', label: 'web' }],
  hostServices: [],
  credentials: [{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }],
  ssh: { forwardAgent: true, commitSigning: false }
})

describe('buildExportBundle', () => {
  const b = buildExportBundle([spec('d1', 'Alpha')], '2026-07-21T00:00:00.000Z')
  it('wraps specs with the envelope and strips id + createdAt', () => {
    expect(b.formatVersion).toBe('1')
    expect(b.kind).toBe('sandbox-definitions')
    expect(b.exportedAt).toBe('2026-07-21T00:00:00.000Z')
    expect((b.definitions[0].definition as Record<string, unknown>).id).toBeUndefined()
    expect((b.definitions[0].definition as Record<string, unknown>).createdAt).toBeUndefined()
    expect(b.definitions[0].definition.name).toBe('Alpha')
  })
  it('preserves the shareable spec fields (mounts, domains, ports, ssh, credential refs)', () => {
    const d = b.definitions[0]
    expect(d.mounts).toEqual([{ hostPath: '/p', mode: 'direct', isPrimary: true }])
    expect(d.domains).toEqual(['api.example.com'])
    expect(d.credentials).toEqual([{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }])
  })
  it('carries no secret values (only credential refs)', () => {
    expect(JSON.stringify(b)).not.toMatch(/sk-|ghp_|password|token"?\s*:\s*"[^"]/i)
  })
})

describe('parseImportBundle', () => {
  const good = JSON.stringify(buildExportBundle([spec('d1', 'Alpha'), spec('d2', 'Beta')], 'now'))
  it('parses a valid bundle', () => {
    const r = parseImportBundle(good)
    expect(r.definitions.map((d) => d.definition.name)).toEqual(['Alpha', 'Beta'])
    expect(r.skipped).toBe(0)
  })
  it('throws on bad JSON / wrong kind / wrong version / non-array', () => {
    expect(() => parseImportBundle('not json')).toThrow(BundleError)
    expect(() => parseImportBundle(JSON.stringify({ formatVersion: '1', kind: 'nope', definitions: [] }))).toThrow(BundleError)
    expect(() => parseImportBundle(JSON.stringify({ formatVersion: '99', kind: 'sandbox-definitions', definitions: [] }))).toThrow(BundleError)
    expect(() => parseImportBundle(JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', definitions: {} }))).toThrow(BundleError)
  })
  it('skips malformed entries but keeps valid ones', () => {
    const mixed = JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now', definitions: [
      buildExportBundle([spec('d1', 'Alpha')], 'now').definitions[0],
      { definition: { description: 'no name' } } // missing name/baseImage/tier
    ] })
    const r = parseImportBundle(mixed)
    expect(r.definitions.map((d) => d.definition.name)).toEqual(['Alpha'])
    expect(r.skipped).toBe(1)
  })
})

describe('dedupeName', () => {
  it('leaves a free name unchanged; suffixes on collision', () => {
    expect(dedupeName('Alpha', new Set())).toBe('Alpha')
    expect(dedupeName('Alpha', new Set(['Alpha']))).toBe('Alpha (imported)')
    expect(dedupeName('Alpha', new Set(['Alpha', 'Alpha (imported)']))).toBe('Alpha (imported 2)')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- defio/bundle`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/defio/bundle.ts`**

```ts
import type { DefinitionSpec } from '@shared/types'

export type ExportableDefinition = Omit<DefinitionSpec, 'definition'> & {
  definition: Omit<DefinitionSpec['definition'], 'id' | 'createdAt'>
}
export interface DefinitionBundle {
  formatVersion: '1'
  kind: 'sandbox-definitions'
  exportedAt: string
  definitions: ExportableDefinition[]
}
export class BundleError extends Error {}

export function buildExportBundle(specs: DefinitionSpec[], now: string): DefinitionBundle {
  return {
    formatVersion: '1',
    kind: 'sandbox-definitions',
    exportedAt: now,
    definitions: specs.map((s) => {
      const { id: _id, createdAt: _createdAt, ...definition } = s.definition
      return { ...s, definition }
    })
  }
}

// A definition entry is usable when it has the required scalar fields; array fields
// default to [] so an older/partial export still imports.
function normalizeEntry(raw: unknown): ExportableDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const def = e.definition as Record<string, unknown> | undefined
  if (!def || typeof def.name !== 'string' || !def.name.trim() || typeof def.baseImage !== 'string' || typeof def.tier !== 'string') return null
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    definition: { name: def.name, description: typeof def.description === 'string' ? def.description : '', baseImage: def.baseImage, tier: def.tier as DefinitionSpec['definition']['tier'] },
    mounts: arr(e.mounts), domains: arr(e.domains), ports: arr(e.ports),
    hostServices: arr(e.hostServices), credentials: arr(e.credentials),
    ssh: (e.ssh && typeof e.ssh === 'object' ? e.ssh : undefined) as ExportableDefinition['ssh']
  }
}

export function parseImportBundle(jsonText: string): { definitions: ExportableDefinition[]; skipped: number } {
  let parsed: unknown
  try { parsed = JSON.parse(jsonText) } catch { throw new BundleError('Not valid JSON') }
  const b = parsed as Record<string, unknown>
  if (!b || b.formatVersion !== '1' || b.kind !== 'sandbox-definitions' || !Array.isArray(b.definitions)) {
    throw new BundleError('Not a valid .sbx.json definition bundle')
  }
  const definitions: ExportableDefinition[] = []
  let skipped = 0
  for (const raw of b.definitions) {
    const e = normalizeEntry(raw)
    if (e) definitions.push(e); else skipped++
  }
  return { definitions, skipped }
}

export function dedupeName(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name
  let candidate = `${name} (imported)`
  let n = 2
  while (existing.has(candidate)) candidate = `${name} (imported ${n++})`
  return candidate
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- defio/bundle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/defio/bundle.ts tests/main/defio/bundle.test.ts
git commit -m "feat(defio): secret-free definition bundle build/parse + name dedupe"
```

---

### Task 2: IPC export/import + native file deps + preload/client

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/ipc/client.ts`
- Test: `tests/main/ipc.test.ts` (additions)

**Interfaces:**
- IPC: `def:export(ids: string[])` → `Result<{ canceled?: boolean; path?: string; count?: number }>`;
  `def:import()` → `Result<{ canceled?: boolean; imported?: string[]; skipped?: number }>`.
- Deps gain: `saveFile?: (defaultName: string, contents: string) => Promise<string | null>`,
  `openFile?: () => Promise<{ path: string; contents: string } | null>`,
  `genId?: () => string` (default `crypto.randomUUID`).

- [ ] **Step 1: Write the failing tests**

In `tests/main/ipc.test.ts` (adapt to the file's `buildHandlers`/adapter/store helpers; seed the in-memory store with a definition):

```ts
it('def:export builds a bundle for selected ids and writes it via saveFile', async () => {
  const store = openStore(':memory:')
  store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Alpha', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
  let written = ''
  const saveFile = async (_name: string, contents: string) => { written = contents; return '/tmp/out.sbx.json' }
  const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, saveFile })
  const r = await h['def:export'](['d1'])
  expect(r.ok && r.data.path).toBe('/tmp/out.sbx.json')
  expect(r.ok && r.data.count).toBe(1)
  expect(JSON.parse(written).kind).toBe('sandbox-definitions')
  expect(JSON.parse(written).definitions[0].definition.name).toBe('Alpha')
})
it('def:export returns canceled when the save dialog is dismissed', async () => {
  const store = openStore(':memory:')
  store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Alpha', description: '', baseImage: 'i', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
  const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, saveFile: async () => null })
  const r = await h['def:export'](['d1'])
  expect(r.ok && r.data.canceled).toBe(true)
})
it('def:import inserts each definition as a new copy with a fresh id and deduped name', async () => {
  const store = openStore(':memory:')
  store.insertDefinitionSpec({ definition: { id: 'existing', name: 'Alpha', description: '', baseImage: 'i', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
  const bundle = JSON.stringify({ formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now', definitions: [
    { definition: { name: 'Alpha', description: '', baseImage: 'i', tier: 'locked' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }
  ] })
  let n = 0
  const h = buildHandlers({ adapter, store, probes, openTerminal: () => {}, openFile: async () => ({ path: '/tmp/in.sbx.json', contents: bundle }), genId: () => `new-${n++}` })
  const r = await h['def:import']()
  expect(r.ok && r.data.imported).toEqual(['Alpha (imported)'])
  const names = store.listDefinitions().map((d) => d.name).sort()
  expect(names).toEqual(['Alpha', 'Alpha (imported)'])
  expect(store.getDefinitionSpec('new-0')).not.toBeNull() // used the injected id
})
it('def:import surfaces an error for a malformed file', async () => {
  const h = buildHandlers({ adapter, store: openStore(':memory:'), probes, openTerminal: () => {}, openFile: async () => ({ path: '/tmp/x', contents: 'not json' }) })
  const r = await h['def:import']()
  expect(r.ok).toBe(false)
})
```

(Add `saveFile`/`openFile`/`genId` to the base adapter/deps stub only where each test needs them; they are optional on `Deps`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/main/ipc.test.ts`
Expected: FAIL — handlers missing.

- [ ] **Step 3: Implement handlers in `ipc.ts`**

- Import: `import { buildExportBundle, parseImportBundle, dedupeName } from './defio/bundle'`.
- Add to `Deps`:
  ```ts
  saveFile?: (defaultName: string, contents: string) => Promise<string | null>
  openFile?: () => Promise<{ path: string; contents: string } | null>
  genId?: () => string
  ```
- Add to the return-type object:
  ```ts
  'def:export': (ids: string[]) => Promise<Result<{ canceled?: boolean; path?: string; count?: number }>>
  'def:import': () => Promise<Result<{ canceled?: boolean; imported?: string[]; skipped?: number }>>
  ```
- Handlers (place near the other `def:*`):
  ```ts
  'def:export': (ids) => wrap(async () => {
    if (!deps.saveFile) throw new Error('file save not configured')
    const specs = ids.map((id) => deps.store.getDefinitionSpec(id)).filter((s): s is DefinitionSpec => s !== null)
    if (specs.length === 0) throw new Error('No definitions to export')
    const bundle = buildExportBundle(specs, new Date().toISOString())
    const defaultName = specs.length === 1
      ? `${specs[0].definition.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.sbx.json`
      : `sandbox-definitions-${specs.length}.sbx.json`
    const path = await deps.saveFile(defaultName, JSON.stringify(bundle, null, 2))
    if (!path) return { canceled: true }
    deps.log?.info(`Exported ${specs.length} definition(s) to ${path}`)
    return { path, count: specs.length }
  }),
  'def:import': () => wrap(async () => {
    if (!deps.openFile) throw new Error('file open not configured')
    const file = await deps.openFile()
    if (!file) return { canceled: true }
    const { definitions, skipped } = parseImportBundle(file.contents)
    const genId = deps.genId ?? (() => crypto.randomUUID())
    const existing = new Set(deps.store.listDefinitions().map((d) => d.name))
    const imported: string[] = []
    for (const d of definitions) {
      const name = dedupeName(d.definition.name, existing)
      existing.add(name)
      deps.store.insertDefinitionSpec({ ...d, definition: { ...d.definition, name, id: genId(), createdAt: new Date().toISOString() } })
      imported.push(name)
    }
    deps.log?.info(`Imported ${imported.length} definition(s)${skipped ? `, skipped ${skipped}` : ''} from ${file.path}`)
    return { imported, skipped }
  }),
  ```
  Add `import { randomUUID } from 'crypto'` OR use `crypto.randomUUID()` (node global `crypto`). Prefer an explicit `import { randomUUID } from 'crypto'` and `deps.genId ?? randomUUID`.
- Register:
  ```ts
  ipcMain.handle('def:export', (_e, ids: string[]) => handlers['def:export'](ids))
  ipcMain.handle('def:import', () => handlers['def:import']())
  ```

- [ ] **Step 4: Wire native file deps in `index.ts`**

Add helpers (using `dialog`, `BrowserWindow`, `nodeFs`) and pass into `registerIpc`:
```ts
async function saveFile(defaultName: string, contents: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? undefined
  const res = await dialog.showSaveDialog(win as BrowserWindow, { defaultPath: defaultName, filters: [{ name: 'Sandbox definitions', extensions: ['sbx.json', 'json'] }] })
  if (res.canceled || !res.filePath) return null
  nodeFs.writeFileSync(res.filePath, contents, 'utf8')
  return res.filePath
}
async function openFile(): Promise<{ path: string; contents: string } | null> {
  const win = BrowserWindow.getFocusedWindow() ?? undefined
  const res = await dialog.showOpenDialog(win as BrowserWindow, { properties: ['openFile'], filters: [{ name: 'Sandbox definitions', extensions: ['sbx.json', 'json'] }] })
  if (res.canceled || res.filePaths.length === 0) return null
  return { path: res.filePaths[0], contents: nodeFs.readFileSync(res.filePaths[0], 'utf8') }
}
```
Add `import { app, BrowserWindow, safeStorage, dialog } from 'electron'` (add `dialog` to the existing electron import) and pass `saveFile, openFile` into `registerIpc({ …, saveFile, openFile })`.

- [ ] **Step 5: preload + client**

Preload `api`:
```ts
defExport: (ids: string[]) => ipcRenderer.invoke('def:export', ids),
defImport: () => ipcRenderer.invoke('def:import'),
```
Client interface + fallback:
```ts
defExport(ids: string[]): Promise<Result<{ canceled?: boolean; path?: string; count?: number }>>
defImport(): Promise<Result<{ canceled?: boolean; imported?: string[]; skipped?: number }>>
// fallback:
defExport: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
defImport: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- tests/main/ipc.test.ts defio/bundle` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc.test.ts
git commit -m "feat(defio): def:export/def:import IPC with native save/open + import-as-copy"
```

---

### Task 3: Definition-list UI (selection, toolbar, flash) + App wiring

**Files:**
- Modify: `src/renderer/screens/Definitions.tsx`, `src/renderer/App.tsx`, `src/renderer/i18n/en.ts`, `de.ts`
- Test: `tests/renderer/Definitions.test.tsx`

**Interfaces:**
- `Definitions` new props: `onImport: () => void`, `onExport: (ids: string[]) => void`, `flash?: { kind: 'info' | 'error'; text: string } | null`.
- Selection state (`Set<string>`) is local to `Definitions`.

- [ ] **Step 1: Add i18n keys (en + de)**

In the `definitions` group (en): `import: 'Import'`, `export: 'Export'`, `exportHint: 'Select definitions to export'`, `selectedCount: '{count} selected'`, `clearSelection: 'Clear selection'`, `selectAll: 'Select all'`. Add German equivalents in `de.ts`.

- [ ] **Step 2: Write the failing test**

In `tests/renderer/Definitions.test.tsx` (create/extend; presentational component takes props):

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Definitions } from '../../src/renderer/screens/Definitions'
import type { Definition } from '../../src/shared/types'

const defs: Definition[] = [
  { id: 'd1', name: 'Alpha', description: '', baseImage: 'i:t', tier: 'locked', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'd2', name: 'Beta', description: '', baseImage: 'i:t', tier: 'open', createdAt: '2026-01-02T00:00:00Z' }
]
function setup(over = {}) {
  const props = { definitions: defs, onCreate: vi.fn(), onImport: vi.fn(), onExport: vi.fn(), ...over }
  render(<Definitions {...props} />)
  return props
}

describe('Definitions import/export', () => {
  it('Export is disabled until a row is selected', () => {
    setup()
    expect(screen.getByRole('button', { name: /^export$/i })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Select Alpha'))
    expect(screen.getByRole('button', { name: /^export$/i })).not.toBeDisabled()
  })
  it('exports the selected ids', () => {
    const p = setup()
    fireEvent.click(screen.getByLabelText('Select Alpha'))
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }))
    expect(p.onExport).toHaveBeenCalledWith(['d1'])
  })
  it('select-all selects every row and shows the count', () => {
    setup()
    fireEvent.click(screen.getByLabelText('Select all'))
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument()
  })
  it('Import calls onImport', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(p.onImport).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- Definitions`
Expected: FAIL — no import/export UI.

- [ ] **Step 4: Implement in `Definitions.tsx`**

- Add `useState` import; local `const [selected, setSelected] = useState<Set<string>>(new Set())`.
- Props: add `onImport`, `onExport`, `flash?`.
- Header actions (before Create): Import + Export buttons:
  ```tsx
  <button className="btn btn-secondary" onClick={onImport}>{t('definitions.import')}</button>
  <button className="btn btn-secondary" disabled={selected.size === 0} title={selected.size === 0 ? t('definitions.exportHint') : undefined} onClick={() => onExport([...selected])}>{t('definitions.export')}</button>
  ```
- Table: add a leading `<th style={{ width: 40 }}>` with a select-all checkbox
  (`aria-label={t('definitions.selectAll')}`, checked when all selected, onChange toggles
  all ids), and a leading `<td>` per row with a checkbox
  (`aria-label={`Select ${d.name}`}`, checked `selected.has(d.id)`, toggles that id).
  Highlight selected rows (`className={selected.has(d.id) ? 'selected' : undefined}`).
- Selection bar below the table when `selected.size > 0`:
  ```tsx
  <div className="selection-bar"><span>{t('definitions.selectedCount', { count: selected.size })}</span>
    <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>{t('definitions.clearSelection')}</button></div>
  ```
- Per-row **Export** shortcut button (in the row actions): `onClick={() => onExport([d.id])}`.
- Flash region above the table: `{flash && <p className={…}>{flash.text}</p>}`.
- Toggle helpers: `toggle(id)` add/remove in a new Set; `toggleAll()` set to all ids or empty.

- [ ] **Step 5: Wire `App.tsx`**

- Add `const [defFlash, setDefFlash] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)`.
- Handlers:
  ```tsx
  async function onImportDefs(): Promise<void> {
    const r = await api.defImport()
    if (!r.ok) { setDefFlash({ kind: 'error', text: t('definitions.importError') }); return }
    if (r.data.canceled) return
    await loadDefs()
    setDefFlash({ kind: 'info', text: t('definitions.imported', { count: r.data.imported?.length ?? 0, skipped: r.data.skipped ?? 0 }) })
  }
  async function onExportDefs(ids: string[]): Promise<void> {
    const r = await api.defExport(ids)
    if (!r.ok) { setDefFlash({ kind: 'error', text: t('definitions.exportError') }); return }
    if (r.data.canceled) return
    setDefFlash({ kind: 'info', text: t('definitions.exported', { count: r.data.count ?? 0 }) })
  }
  ```
- Pass to `<Definitions … onImport={() => void onImportDefs()} onExport={(ids) => void onExportDefs(ids)} flash={defFlash} />`.
- Add the referenced i18n keys `importError`, `exportError`, `imported`, `exported` (en + de).

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npm test -- Definitions App` then `npm run typecheck` then `npm run build`
Expected: PASS; typecheck clean; build succeeds. (Update any existing `Definitions`/`App` test that renders `<Definitions>` to pass the new required `onImport`/`onExport` props; add `defImport`/`defExport` to App test api mocks.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/screens/Definitions.tsx src/renderer/App.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/Definitions.test.tsx tests/renderer/App.test.tsx
git commit -m "feat(definitions): v11 import/export UI — selection, toolbar, selection bar, flash"
```

---

### Task 4: Full verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Typecheck** — `npm run typecheck` (clean).
- [ ] **Step 2: Full suite** — `npm test` (all green; fix any DefinitionSpec fixtures / api mocks the new props/handlers touched).
- [ ] **Step 3: Build** — `npm run build` (succeeds).
- [ ] **Step 4: Manual smoke (optional)** — select two definitions → Export → a `.sbx.json` with both (no secret values) is written; Import that file → two new copies appear (names suffixed "(imported)"), credentials empty; open one → fill credentials → launch works.
- [ ] **Step 5: Finish** — announce and use `superpowers:finishing-a-development-branch`; verify tests; present merge/PR options.

---

## Self-Review

**Spec coverage:** A (format) → Task 1. B (core) → Task 1. C (export) → Task 2. D (import) → Task 2. E (interfaces) → Tasks 2, 3. Definition-list UI (v11) → Task 3. Testing → each task + Task 4. All covered.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `ExportableDefinition`/`DefinitionBundle`/`BundleError`/`buildExportBundle`/`parseImportBundle`/`dedupeName` defined in Task 1 and used verbatim in Task 2. IPC `def:export(ids)`/`def:import()` result shapes match across `ipc.ts`, preload, client, and `App` handlers. Deps `saveFile`/`openFile`/`genId` names match between `ipc.ts` and `index.ts`. `Definitions` props `onImport`/`onExport`/`flash` match Task 3 impl + `App` wiring. Secret-free guarantee asserted by a test in Task 1.
