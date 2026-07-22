# Advanced Kit Configuration — Custom Kit YAML (Phase 1) — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorming)
**Mockup:** `brainstorm/mockup/AI Sandbox Manager v12` (Advanced step)

## Goal

Let a user attach a custom kit `commands:` block (`install` / `startup` / `initFiles`)
to a sandbox definition via a new **Advanced** step in the wizard. The snippet is
stored on the definition and merged into the kit the app already generates, so the
sandbox runs the user's install/startup commands and seeds init files at create time.

## Scope

**In scope (Phase 1):**
- New "Advanced" wizard step (step 6, before Review).
- A **Custom Kit YAML** editor: paste a `commands:` block; Reformat + Validate buttons.
- Persist the snippet on the definition; merge it into the generated kit at launch.

**Out of scope (deferred to a separate Phase 2 spec):**
- **Community Mixins** — browsing/uploading/applying community mixin kits from
  `docker/sbx-kits-contrib`. The Advanced panel reserves space for it (a non-functional
  "coming soon" placeholder per the mockup), but no browse/upload/apply logic ships now.
  Deferred because `sbx` has no kit-catalog command, so the catalog source (curated
  static list vs live GitHub fetch), uploaded-kit storage, and applied-kit network
  reachability need their own design.

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Phasing | Custom Kit YAML now; Community Mixins later |
| Editor content / merge | A `commands:` block only (`install`/`startup`/`initFiles`), **merged** into the app-generated kit. The app keeps owning `network.allowedDomains`/`name`. |
| Validation strictness | **Block save** when the YAML doesn't parse/merge; deeper `sbx kit validate` is **advisory** (never blocks; unavailable when sbx is missing) |

## Architecture

The app generates a mixin kit `spec.yaml` per definition (`buildKitSpec`, currently
`schemaVersion`/`kind`/`name`/`displayName` + `network.allowedDomains`) written to
`<workspace>/.sandbox/kit` and passed to `sbx create` via `--kit`. Phase 1 adds a
`commands:` top-level key to that generated spec from the user's stored snippet.
Because `commands` is disjoint from the app-owned keys (`network`, `name`, …), the
merge is a clean append — no full YAML round-trip of the app-owned parts, so existing
`buildKitSpec` output for those parts is unchanged.

## Components & data flow

### Data model & storage
- `DefinitionSpec` gains `kitCommandsYaml?: string` — the normalized YAML the user
  pasted (absent/empty when unused).
- `Draft` (wizard) gains `kitCommandsYaml: string`; `toSpec` writes it (trimmed;
  omitted when empty), `draftFromSpec` seeds it.
- DB: add `kit_commands_yaml TEXT` to the `definition` table, **schema v8**, via a
  non-destructive `ALTER TABLE definition ADD COLUMN kit_commands_yaml TEXT` guarded by
  a column-existence check (mirrors the existing v5→v6/v6→v7 migrations). Written in
  `insertDefinitionSpec`/`updateDefinitionSpec`, read in `getDefinitionSpec`.

### YAML helper (pure, shared)
- New module `src/main/kit/commands.ts` exporting `normalizeCommandsYaml(text: string):
  { ok: true; yaml: string } | { ok: false; error: string }`.
  - Parse with **`js-yaml`** (new dependency; lockfile must stay pinned to
    `registry.npmjs.org` per the project's CI constraint).
  - Valid iff: parses to a mapping whose only top-level key is `commands`, and
    `commands` contains only `install` (string), `startup` (string), and/or
    `initFiles` (array). Anything else → `{ ok:false, error }`.
  - On success return the re-dumped (normalized) YAML.
- Used by **Reformat**, the **save parse-gate**, and to build the merged kit.

### Kit merge
- `buildKitSpec(spec)` appends the normalized `commands:` block after `network:` when
  `spec.kitCommandsYaml` is present and parses; when absent/empty, output is unchanged.
- Indentation: the stored value is already normalized top-level YAML (`commands:` at
  column 0), appended as-is to the generated spec lines.

### Validation & reformat
- **Reformat** (renderer): calls `normalizeCommandsYaml`; on ok replaces the editor
  text with the normalized YAML, on error shows the message inline (text untouched).
- **Validate** (IPC `kit:validate(yaml)` in main, advisory): normalize → if parse fails
  return the parse error; else merge into a throwaway generated kit, write to a temp
  dir, run `sbx kit validate <dir>` via the SbxAdapter, return `{ ok, message }`. If
  `sbx` is not installed, return `{ ok: true, message: 'validation unavailable (sbx not found)' }`
  (advisory, non-blocking).
- **Save gate** (`toSpec`/submit): if `kitCommandsYaml` is non-empty and
  `normalizeCommandsYaml` fails, block create/save with an inline error. Deeper
  `sbx kit validate` findings never block.

### Wizard Advanced step
- `CreateDefinition.tsx`: new panel at `draft.step === 6`. Step order becomes
  1 Workspace · 2 Base Image · 3 Network · 4 Credentials · 5 Ports · 6 Advanced ·
  7 Review (only Review shifts, 6→7; Advanced is inserted at 6).
  Heading "Advanced Settings", subtitle, a "Kit reference →"
  external doc link, and the Custom Kit YAML section: a monospace `<textarea>`,
  **Reformat** + **Validate** buttons, an inline validation/parse message line, helper
  text ("Paste a `commands:` block … Leave empty to skip"). A disabled "Community
  Mixins — coming soon" placeholder marks the deferred half.
- `TOTAL_STEPS` 6→7; `stepKeys` gains `advanced` before `review`; `canAdvance` treats
  step 6 as always-advanceable (empty is valid; the parse gate runs at submit).
- i18n: `wizard.steps.advanced` + Advanced-panel strings in en + de (parity enforced
  by typecheck).

## Error handling
- Unparseable/invalid-shape YAML: inline error on Reformat and blocks save.
- `sbx kit validate` failure: advisory red message under the editor; save still allowed.
- `sbx` missing: Validate returns an advisory "unavailable" note.
- A definition whose stored YAML somehow fails to merge at launch: `buildKitSpec` omits
  the commands block and logs a warning rather than producing invalid YAML (defensive;
  the save gate makes this unreachable in normal flow).

## Testing
- **Pure:** `normalizeCommandsYaml` (valid commands round-trips; rejects non-mapping,
  disallowed top-level keys, bad `commands.*` shapes, unparseable); `buildKitSpec`
  (appends `commands:` when present, unchanged when absent, network still app-owned).
- **Draft:** `toSpec`/`draftFromSpec` round-trip `kitCommandsYaml` (and omit when empty).
- **DB:** persist/read `kit_commands_yaml`; migration adds the column to a v7 DB.
- **IPC:** `kit:validate` merges + shells `sbx kit validate` (adapter mocked) → ok/fail;
  sbx-missing → advisory note.
- **Wizard (renderer):** Advanced step renders; submit blocks on unparseable YAML;
  Reformat normalizes valid YAML.

## Dependencies
- Add `js-yaml` (+ `@types/js-yaml`) to the project. Regenerating the lockfile must
  keep `resolved` URLs on `registry.npmjs.org` (see the CI lockfile constraint).
