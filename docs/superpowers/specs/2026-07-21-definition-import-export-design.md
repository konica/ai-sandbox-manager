# Import / Export Sandbox Definitions — Design

**Status:** Approved (brainstorm) — pending spec review
**Date:** 2026-07-21
**Scope:** Export one or more sandbox definitions (multi-select) to a shareable `.sbx.json` file, and import such a file — without any secret credential values. Definition-list UI per the v11 mockup.

## Problem

Users want to share sandbox definitions with teammates. A definition captures the
environment (base image, network tier + domains, ports, host services, SSH config,
mounts, and which credentials are needed) but the **secret values must not travel**
— the teammate provides their own before use.

## Grounding (verified)

- **`DefinitionSpec` is secret-free by construction.** Its `credentials` are
  `CredentialRef`s carrying only metadata (`serviceId`, `envVar`, `host`, `username`,
  `scope`, `domains`, `label`, `store`) — **no value field**. Secret values live in the
  OS vault (safeStorage), keyed `${definitionId}:…`, and are never part of the spec.
  Exporting the spec therefore leaks no secrets.
- Existing plumbing: `store.getDefinitionSpec(id)` returns the full spec;
  `store.insertDefinitionSpec(spec)` persists a new one; `store.listDefinitions()`.
  The app already uses **native dialogs** in main (`dialog.showOpenDialog` for folder
  picking).
- **Launch already tolerates missing credentials:** for any `CredentialRef` with no
  staged vault value, `launchDefinition` skips it and logs a clear warning. So an
  imported definition is launchable once the teammate fills in values — no new gating
  needed.
- v11 mockup defines the definition-list UI: header **Import**/**Export** buttons,
  per-row checkboxes + select-all, a selected-row highlight, a selection bar
  ("N selected" + Clear), a per-row **Export** shortcut, and a flash-message area.

## Decisions (from brainstorm)

- **Multi-select export** via row checkboxes (not a single "export all").
- **Host paths kept as hints** — the workspace path and extra-folder paths are exported
  as-is; the teammate edits them if their machine differs (not blanked).
- **Import creates a new copy** — fresh `id` + `createdAt`; on name collision append
  `" (imported)"`, then `" (imported 2)"`, … Never overwrites.
- **One canonical bundle format** even for a single definition.
- **File I/O via native Save/Open dialogs** in main (consistent with the app), not
  browser download/upload.

## Non-goals (YAGNI)

- Transferring secret values across machines (by design — teammate re-enters).
- Rewriting/relocating host paths on import (kept as hints).
- A dedicated "Export all" button (multi-select covers it).
- Merging into / updating an existing definition on import.

## Architecture

### A. File format — `.sbx.json` bundle

```jsonc
{
  "formatVersion": "1",
  "kind": "sandbox-definitions",
  "exportedAt": "2026-07-21T09:00:00.000Z",
  "definitions": [
    {
      // A DefinitionSpec WITHOUT definition.id and definition.createdAt.
      "definition": { "name": "prj-alpha", "description": "…", "baseImage": "…", "tier": "locked" },
      "mounts": [ … ], "domains": [ … ], "ports": [ … ],
      "hostServices": [ … ], "ssh": { … }, "credentials": [ /* refs, no values */ ]
    }
  ]
}
```

Secret-free by construction (the spec has no values). `id`/`createdAt` are dropped on
export and regenerated on import.

### B. Pure, tested core — `src/main/defio/bundle.ts`

```ts
export interface ExportableDefinition { /* DefinitionSpec minus definition.id + createdAt */ }
export interface DefinitionBundle { formatVersion: '1'; kind: 'sandbox-definitions'; exportedAt: string; definitions: ExportableDefinition[] }

// Strip id/createdAt from each spec, wrap in the envelope. `now` injected for tests.
export function buildExportBundle(specs: DefinitionSpec[], now: string): DefinitionBundle
// Parse + validate JSON text → the exportable definitions. Throws BundleError on bad
// version/kind/shape. Tolerates and skips individual malformed entries, reporting them.
export function parseImportBundle(jsonText: string): { definitions: ExportableDefinition[]; skipped: number }
// "Foo" taken → "Foo (imported)"; that taken → "Foo (imported 2)" …
export function dedupeName(name: string, existing: Set<string>): string
```

`parseImportBundle` validates `formatVersion === '1'` and `kind === 'sandbox-definitions'`,
that `definitions` is an array, and that each entry has the required `definition.name`,
`baseImage`, `tier`, and array fields — coercing/skipping malformed entries rather than
failing the whole import (returns a `skipped` count).

### C. Export (main)

`def:export(ids: string[])`:
1. Gather specs via `store.getDefinitionSpec(id)` (skip ids that resolve null).
2. `buildExportBundle(specs, new Date().toISOString())`.
3. Native **Save** dialog (default filename: one → `<name>.sbx.json`; many →
   `sandbox-definitions-<count>.sbx.json`). Cancel → `{ canceled: true }`.
4. Write the JSON (pretty-printed) via `fs`.
5. Return `{ path, count }` for the flash.

### D. Import (main)

`def:import()`:
1. Native **Open** dialog filtered to `.sbx.json` / JSON. Cancel → `{ canceled: true }`.
2. Read the file; `parseImportBundle(text)` (BundleError → `Result` error → flash).
3. For each definition: assign a fresh `id` (uuid) + `createdAt` (now); resolve name via
   `dedupeName(name, existingNames)` (existing = current definition names + names added so
   far this import); `store.insertDefinitionSpec(spec)`.
4. Return `{ imported: string[]; skipped: number }` for the flash.

Because the vault has no values for the new ids, the imported definitions have empty
credential slots — the teammate fills them in the Credentials step before launch.

### E. Interfaces

- **IPC** (`src/main/ipc.ts` + preload + renderer client):
  - `def:export(ids: string[])` → `Result<{ canceled?: boolean; path?: string; count?: number }>`
  - `def:import()` → `Result<{ canceled?: boolean; imported?: string[]; skipped?: number }>`
- **Deps** (`ipc.ts`): inject `saveFile(defaultName, contents) → path | null` and
  `openFile(filters) → { path, contents } | null` (implemented in `index.ts` with
  `dialog` + `fs`), plus `now`/`genId` (default `crypto.randomUUID`) for the import copy.
  Keeps `ipc.ts` testable without Electron dialogs.
- **Renderer** (`Definitions.tsx` + `App.tsx`):
  - `Definitions` gains selection state (`Set<string>`), checkboxes + select-all,
    selection bar, header Import/Export buttons, per-row Export, and a `flash` prop.
  - New props: `onImport(): void`, `onExport(ids: string[]): void`.
  - `App` implements them via the IPC, refreshes `loadDefs()` after import, and passes a
    flash message ({ kind, text }) down for display.

### F. Data flow

```
Select rows → Export (header) → def:export(ids)
  → gather specs → buildExportBundle → Save dialog → write .sbx.json → flash "Exported N to <file>"

Import → def:import() → Open dialog → parseImportBundle
  → each: new id/createdAt + dedupeName → insertDefinitionSpec
  → loadDefs() + flash "Imported N definition(s)" (+ "M skipped" if any)
```

## Error handling

- Export with an empty selection: the header Export button is disabled (no call).
- Save/Open dialog canceled: no-op, no flash (or a subtle "Canceled").
- Malformed file (bad JSON / wrong `formatVersion` / wrong `kind`): `Result` error →
  red flash "Not a valid .sbx.json definition file."; nothing imported.
- Individual malformed definition inside a valid bundle: skipped; counted in the flash
  ("Imported 2, skipped 1").
- File read/write failure: `Result` error → red flash; never crashes.

## Testing

- **Unit — `buildExportBundle`**: drops `definition.id`/`createdAt`; wraps with
  `formatVersion`/`kind`/`exportedAt`; **asserts no secret values appear** (JSON has only
  credential refs) and the round-trip of a full spec preserves mounts/domains/ports/
  hostServices/ssh/credential-refs.
- **Unit — `parseImportBundle`**: valid bundle → definitions; wrong version/kind →
  throws; non-array `definitions` → throws; a malformed entry among valid ones →
  skipped + counted; not-JSON → throws.
- **Unit — `dedupeName`**: free name unchanged; collision → " (imported)"; repeated →
  " (imported 2)".
- **Unit — ipc `def:export`**: gathers specs, calls `saveFile` with pretty JSON,
  returns count; canceled dialog → `{ canceled: true }`.
- **Unit — ipc `def:import`**: parses, assigns new ids (never reuses the source id),
  dedupes names against existing, inserts each; returns imported names + skipped;
  malformed file → error result.
- **Renderer — `Definitions`**: select-all toggles all rows; Export disabled with no
  selection and calls `onExport(selectedIds)` when clicked; selection bar shows the
  count + Clear; per-row Export calls `onExport([id])`; Import calls `onImport`.

## Phase 0 spike

None required — no new sbx mechanics; native `dialog`/`fs` and the store APIs are
already used in the app. (`crypto.randomUUID` for new ids matches the wizard's id gen.)
