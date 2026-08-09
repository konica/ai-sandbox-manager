# Adjust disk/volume size when rebuilding an instance

**Status:** Approved (design)
**Date:** 2026-08-09

## Problem

The disk-size feature (PR #13) lets a definition carry a default disk size and lets the
user override it in the Launch dialog for a fresh instance. The end user also wants to
change the disk size of an **existing** instance. `sbx` cannot resize a live volume, so
the only way to give an instance a different size is to **rebuild** it — remove the
sandbox and recreate it from its definition (a fresh `sbx create`, which is where the
volume — and thus `DOCKER_SANDBOXES_DOCKER_SIZE` — is applied). Rebuild already exists;
today it always uses the definition's default size. This feature adds an editable disk
size to the rebuild flow, pre-filled with the size the instance was actually created with.

## Scope decision (settled during brainstorming)

- **Rebuild only.** Attach / Open Agent (`sbx run --name`) reconnects to the existing
  volume and cannot change its size, so it is out of scope. Rebuild recreates the sandbox
  (workspace files on the host are kept; in-container state is discarded — as rebuild
  already does today).
- **Pre-fill with the size THIS instance was created with**, not the definition default.
  This requires persisting a per-instance disk size (new stored field + migration).

## Mechanism recap (unchanged from PR #13)

Disk size has no `sbx` CLI flag; it is read from the `DOCKER_SANDBOXES_DOCKER_SIZE` env
var on the `sbx create` process, injected as an inline prefix on the create step in
`launchCommand`. `launchDefinition(deps, definitionId, requestedName?, sessionName?,
opener?, rawTags?, diskSizeOverride?)` already resolves the effective size as
`diskSizeOverride !== undefined ? parseDiskSize(diskSizeOverride) : spec.definition.diskSize`
and threads it into `launchCommand`. Rebuild goes through `launchDefinition`, so wiring an
override into rebuild reuses all of that.

## Components & boundaries

| Layer | File | Change |
|---|---|---|
| Type | `src/shared/types.ts` | Add `diskSize?: string` to `InstanceMeta` and to `InstanceView`. |
| Store | `src/main/store/db.ts` | Migration v12→v13 adds `instance_meta.disk_size TEXT`; thread through `upsertInstanceMeta` (INSERT + ON CONFLICT) and `listInstanceMeta` (SELECT + map). |
| Launch | `src/main/launch.ts` | The existing `upsertInstanceMeta({...})` in `launchDefinition` records `diskSize: disk` (the already-resolved effective size). |
| Reconcile | `src/main/reconciler.ts` | The `InstanceView` returned by the `.map` carries `diskSize: meta?.diskSize`. |
| Rebuild UI | `src/renderer/components/RebuildDialog.tsx` (new) | Rebuild confirmation + editable "Disk size" input, pre-filled from the instance's size (else the definition default). |
| App wiring | `src/renderer/App.tsx` | Opening a rebuild becomes async: fetch the definition spec, compute the pre-fill (`instance.diskSize ?? spec.definition.diskSize ?? ''`), render `RebuildDialog` (stop/remove keep `ConfirmModal`), thread `diskSize` into `api.instanceRebuild`. |
| Rebuild IPC | `src/preload/index.ts`, `src/renderer/ipc/client.ts`, `src/main/ipc.ts` | `instanceRebuild(name, opener?, diskSize?)` end to end; handler passes `diskSize` as the override to `launchDefinition`. |

## Data model & persistence

- `InstanceMeta` gains `diskSize?: string` (the size the instance's volume was created
  with; `undefined` = Docker's 50 GB default). `InstanceView` gains the same, so the
  renderer can pre-fill the rebuild field.
- **Migration** is a new guarded block (v12→v13), bumping `PRAGMA user_version` to 13:
  `if (!imCols.includes('disk_size')) ALTER TABLE instance_meta ADD COLUMN disk_size TEXT;`
  (`imCols` = the existing `instance_meta` column snapshot). Non-destructive; existing rows
  stay NULL → read back as `undefined` (pre-fill blank → Docker default on rebuild, matching
  prior behavior).
- `upsertInstanceMeta` adds `disk_size` to the INSERT column list, the `@diskSize` value
  (bound as `m.diskSize ?? null`), and the `ON CONFLICT … DO UPDATE SET disk_size =
  excluded.disk_size`. `listInstanceMeta` adds `disk_size AS diskSize` to the SELECT and
  maps `r.diskSize != null ? String(r.diskSize) : undefined`.
- **Recording the value:** `launchDefinition` already computes `disk` (the effective size
  for this launch) just before building the command. Its existing `upsertInstanceMeta({
  sbxName: name, definitionId, createdByApp: true, createdAt, credFingerprint })` call adds
  `diskSize: disk`. So **every** launch — fresh (from the Launch dialog) or a rebuild —
  records the size its sandbox was created with. No separate write path; the value carries
  forward across successive rebuilds automatically.

## Reconcile

The `reconciler` `.map` that builds each `InstanceView` already reads the instance's `meta`
row (for `createdAt`, `credsDrift`, `tags`). Add `diskSize: meta?.diskSize` to the returned
object — the size *this instance* was created with (`undefined` for pre-feature, adopted,
or CLI instances whose size we never recorded).

## Pre-fill precedence (important — avoids a rebuild regression)

The rebuild field is pre-filled with **`instance.diskSize ?? <definition default> ?? ''`**:
the size the instance was created with, else the definition's current default, else blank.

Why the definition-default fallback matters: rebuild always passes the field value as the
override, and `launchDefinition` treats a passed value as authoritative — an empty string
parses to `undefined` → **Docker's 50 GB default**, which does *not* fall back to the
definition default. Today's rebuild (no override) *does* fall back to the definition
default. So if a pre-feature instance whose definition has a custom size (e.g. `30g`)
pre-filled blank, rebuilding it would silently drop from `30g` to `50g`. Seeding the field
from the definition default when the instance's size is unknown preserves today's behavior
(`30g` shown → `30g` applied) and is a sensible suggestion for CLI/adopted instances too.

`App.tsx` sources the definition default by fetching the instance's definition spec when it
opens the rebuild dialog (via `api.defGetSpec`, exactly as `openLaunchDialog` already does
for clone-mode detection), reading `spec.definition.diskSize`. `InstanceView.diskSize`
stays the instance's own size; the definition default lives only in the dialog-open path.

## Rebuild UI — `RebuildDialog`

Rebuild currently shares the generic `ConfirmModal` (also used by stop/remove). Because it
now needs an input with validation, rebuild gets its own small component
`RebuildDialog.tsx`, mirroring `LaunchDialog`'s disk-size field:

- Shows the existing rebuild title/body (`instances.rebuildTitle` / `instances.rebuildBody`)
  so the "recreates the sandbox, in-container state is lost, workspace files kept"
  explanation is unchanged.
- A "Disk size" input, `aria-label="Disk size"`, pre-filled from `initialDiskSize` (the
  precedence value computed above), with the same inline `role="alert"` error via
  `isValidDiskSize` and a Rebuild button disabled when the value is invalid (empty is valid
  = Docker default) — identical validation idiom to `LaunchDialog`.
- Reuses the existing `launch.diskSizeLabel` / `launch.diskSizePlaceholder` /
  `launch.diskSizeInvalid` i18n strings (no new keys → no i18n parity change) and the
  existing `instances.rebuildTitle` / `instances.rebuildBody` / `instances.confirmRebuild` /
  `instances.cancel`.
- Props: `{ name: string; initialDiskSize: string; onRebuild: (diskSize: string) => void; onCancel: () => void }`.

`App.tsx`: opening a rebuild is now async (mirroring `openLaunchDialog`) — it fetches the
instance's definition spec, computes `initialDiskSize = instance.diskSize ??
spec.definition.diskSize ?? ''`, and stores it on the `pending` rebuild state. The
`pending.kind === 'rebuild'` case renders `<RebuildDialog>` (stop/remove/def-remove keep the
shared `ConfirmModal`). `onRebuild(diskSize)` calls `api.instanceRebuild(name, opener, diskSize)`.

## Thread the override through rebuild

- `instanceRebuild(name, opener?, diskSize?: string)` in `src/preload/index.ts` (forward
  `diskSize` in the `ipcRenderer.invoke`) and in the `src/renderer/ipc/client.ts` interface.
- `src/main/ipc.ts`: the `instance:rebuild` handler type and impl gain `diskSize?: string`;
  the impl passes it as the 7th argument to `launchDefinition(launchDeps(), definitionId,
  undefined, undefined, opener ?? 'terminal', tags, diskSize)`. The `ipcMain.handle`
  registration forwards the new arg.
- Because `launchDefinition` resolves `diskSizeOverride !== undefined ? parseDiskSize(...) :
  spec.definition.diskSize`, the value from the dialog governs the rebuild's `sbx create`.
  The field is pre-filled with the instance's created-with size, so **leaving it untouched
  re-applies the same size**; editing changes it; clearing it → Docker default. The new
  instance then persists its own disk size (see Persistence), so the choice sticks across
  future rebuilds.

## Edge cases

- **Instance created before this feature** (no `disk_size` row / pre-migration): `diskSize`
  is `undefined` → the field pre-fills from the definition default (precedence rule), so an
  unchanged rebuild applies that default — matching today's rebuild behavior exactly.
- **Adopted / CLI instance** (no app metadata, `meta === null`): same — field pre-fills from
  the definition default; blank only if the definition also has none (→ Docker default,
  which is what today's rebuild yields too).
- **Instance created at Docker's default** (app instance, definition default unset and no
  override): `instance.diskSize` is `undefined` and the definition default is `undefined` →
  field blank → rebuild keeps Docker default. Consistent with how it was created.
- **Definition default changed since the instance was created:** the field shows the
  *instance's* size (precedence: instance first), so an unchanged rebuild keeps the size the
  instance actually has; the user can type the definition's new default if they want it.

## Out of scope

- Changing disk size on Attach / Open Agent (impossible — same volume).
- Resizing a live volume (sbx cannot).
- Showing the current disk size elsewhere in the Instance Detail UI (this feature only adds
  it to the rebuild dialog; a read-only display could be a later addition).

## Testing

- `db` — `instance_meta` `disk_size` round-trips via `upsertInstanceMeta`/`listInstanceMeta`;
  migration adds the column; `null` → `undefined`.
- `launch` — `launchDefinition` records the effective `disk` onto the instance-meta upsert
  (assert the mock store's `upsertInstanceMeta` received `diskSize`).
- `reconciler` — `InstanceView.diskSize` is populated from the meta row; `undefined` when no
  meta.
- `RebuildDialog` — pre-fills from `initialDiskSize`; edit changes the value passed to
  `onRebuild`; empty stays valid (button enabled); invalid disables the Rebuild button and
  shows the inline error.
- App pre-fill precedence — `instance.diskSize` wins over the definition default; falls back
  to the definition default when the instance's size is unknown; blank when neither is set.
  (Unit-test the small pure precedence helper, e.g. `rebuildInitialDiskSize(instanceDiskSize,
  definitionDiskSize)`, so it doesn't require driving the async App path.)
- `ipc` — `instance:rebuild` forwards the `diskSize` override into the rebuild's `sbx create`
  step (assert the captured terminal command contains `DOCKER_SANDBOXES_DOCKER_SIZE='<size>'`).
- No new i18n keys → no parity change.
