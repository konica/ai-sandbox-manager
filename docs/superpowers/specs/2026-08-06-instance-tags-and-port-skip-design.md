# Design: Instance tags + smart port-forward skip

**Date:** 2026-08-06
**Status:** Approved (ready for implementation planning)

## Problem

End users launch multiple instances from the same sandbox definition and need a
way to tell them apart, organize them, and filter them. Two connected needs:

1. **Tags** — the user assigns free-form tags to an instance so they can manage
   and filter instances on the Instances screen. Tags are also folded into the
   generated instance name so instances are recognizable at a glance (and in the
   `sbx` CLI's own output).
2. **Port-forward conflicts** — running a second instance of a definition that
   publishes a *fixed* host port collides on that port. So from the 2nd instance
   onward, fixed-host-port forwards are skipped by default; the user corrects the
   port later from the instance's Ports tab.

## Decisions (resolved during brainstorming)

- **Tag model:** free-form typed tags (chip input). No predefined/managed tag set.
- **Tag editing:** editable both at launch (Launch dialog) and later (Instance Detail).
- **Port skip scope:** on the 2nd+ instance of a definition, skip **only fixed
  host-port forwards** (`hostPort` set). Ephemeral forwards (`hostPort: null`,
  OS-allocated) never collide, so they still apply.
- **Tags in the name:** all tags, slugified and joined, placed between the
  definition slug and the random hash; length-capped.

## Non-goals

- No per-instance port overrides that diverge from the definition. The existing
  `PortsTab` dual-write behavior (live edit also writes back to the definition)
  is left as-is for this feature — see "Known interaction" below.
- No renaming of a live sandbox. The name is a launch-time snapshot of the tags.
- Tags are not pushed to `sbx` as native container labels; they are app-side
  metadata only.
- Definition export/import bundles are unaffected (tags are per-instance).

## Data model

Tags are stored in a **new table**, separate from `instance_meta`, so the
reconciler's adopt/GC upserts (which fully overwrite `instance_meta` rows) can
never clobber tags, and many-tags-per-instance is natural.

```sql
CREATE TABLE IF NOT EXISTS instance_tag (
  sbx_name TEXT NOT NULL,
  tag      TEXT NOT NULL,
  PRIMARY KEY (sbx_name, tag)
);
```

- Keyed by `sbx_name` (the live instance identity), matching `instance_meta`.
- Schema version bump (`PRAGMA user_version`) with a non-destructive
  `CREATE TABLE IF NOT EXISTS`, following the existing forward-only migration style.

`InstanceView` gains a `tags: string[]` field, populated by `reconcile()`.

`Definition` / `DefinitionSpec` are **unchanged** — tags are per-instance, not
part of the reusable blueprint.

### Tag normalization

Applied whenever tags are written (launch or edit):

- Trim surrounding whitespace; drop empty strings.
- Dedupe case-insensitively (first occurrence's casing wins; original casing
  preserved for display).
- Cap per-instance tag **count** and per-tag **length** to sane limits
  (proposed: max 10 tags, each ≤ 32 chars) — over-limit input is truncated/dropped,
  not rejected.

## Store & IPC surface

New `Store` methods:

- `setInstanceTags(sbxName: string, tags: string[]): void` — replaces the tag set
  for one instance (delete + reinsert within a transaction).
- `listInstanceTags(): Map<string, string[]>` (or equivalent) — used by
  `reconcile()` to attach tags to each `InstanceView`.
- Tag cleanup wired into `deleteInstanceMeta(sbxName)` and the reconciler's GC
  path so pruning a dead instance also removes its tags.

IPC:

- `instance:launch` gains a `tags: string[]` argument, threaded through
  preload → `launchDefinition`.
- New `instance:setTags(sbxName, tags[])` handler (wrapped in `Result<T>` like the
  rest), for editing from Instance Detail.
- `instances:list` continues to return `InstanceView[]`, now carrying `tags`.

## Launch flow

In `launchDefinition` (`src/main/launch.ts`):

1. **Name composition.** When no explicit `requestedName` is given, build the base
   name from the definition slug plus the slugified tags, then hash it:
   `<definition-slug>-<tag1>-<tag2>-…-<hash>`. See "Instance naming" below.
   An explicit `requestedName` still wins and bypasses tag folding.
2. **Port skip detection.** Count `instance_meta` rows already linked to this
   `definitionId` (the 10-minute provisioning grace window keeps rapid
   back-to-back launches counted even before they appear in `sbx ls`). If the
   count is ≥ 1, this is a subsequent launch.
3. **Port filtering.** On a subsequent launch, pass only ephemeral ports
   (`hostPort === null`) to `launchCommand()`; fixed-host-port forwards are
   omitted so `sbx ports --publish` never collides. The first instance is
   unchanged. The skip is recorded in the app log.
4. **Persist tags.** After `upsertInstanceMeta`, call `setInstanceTags(name, tags)`
   with the normalized tag set.

`launchCommand()` (`src/main/sbx/translate.ts`) is adjusted to accept the
already-filtered port list rather than always reading `spec.ports`, keeping the
skip decision in `launchDefinition` and the command builder pure.

### Instance naming

```
<definition-slug>-<tag1>-<tag2>-…-<hash>
```

- Each tag is slugified with the same `toSbxName` rules (lowercase,
  non-alphanumerics → `-`), appended in entry order between the definition slug
  and the random hash.
- **Length-capped:** tags are appended only while the base stays under a budget
  (proposed ~40 chars before the `-<hash>` suffix). Tags that would overflow are
  dropped from the *name* but still kept as metadata/chips. The definition slug
  and hash are never dropped, so per-launch uniqueness (via `hashedSandboxName`)
  is preserved.
- **Snapshot semantics:** the name reflects tags as of launch. Later tag edits
  update the chips/filter but never rename the sandbox.

Example: definition "My Proj", tags `[prod, eu]` → `myproj-prod-eu-a1b2c3d4`.

## UI

**LaunchDialog** (`src/renderer/components/LaunchDialog.tsx`)

- A free-form tag chip input above the Open-With radios: type + Enter/comma to
  add a tag, ✕ to remove. The current tags are passed to `onLaunch`.
- Skip note: when the renderer's current instance list already shows ≥ 1 instance
  for this definition **and** the definition has fixed-host-port forwards, show an
  inline note — *"This is instance #N — fixed host-port forwards will be skipped
  to avoid conflicts. Add a corrected port later in the instance's Ports tab."*
  The authoritative skip decision remains in the main process; this note is a
  best-effort prediction from data the renderer already polls.

**Instances screen** (`src/renderer/screens/Instances.tsx`)

- Render each instance's tags as chips (new column, or beneath the name).
- A filter bar: the set of distinct tags across the listed instances rendered as
  toggle chips. Selecting one or more tags filters the table with **OR** semantics
  (show instances having any selected tag). Empty selection shows all.

**Instance Detail** (`src/renderer/screens/detail/…`)

- A tags editor (same chip input) that calls `instance:setTags`, so a running
  instance can be re-tagged. Lives alongside the existing detail tabs; the user
  can re-tag and fix the port on the same screen.

## Known interaction (flagged, not solved)

`PortsTab`'s "add forward" already **dual-writes back to the definition** via
`applyPortEdit` (`src/main/detail/persist.ts`). So when the user adds a corrected
fixed host port on a 2nd instance, it also rewrites the shared definition's ports.
For this feature we **leave that behavior as-is** (MVP) rather than introducing
per-instance port overrides. Flagged here so it's a deliberate choice; revisit if
per-instance correction that doesn't mutate the blueprint becomes a requirement.

## Error handling

- Tag writes are wrapped in `Result<T>` at the IPC boundary like every other
  handler; a failed tag write never throws across IPC.
- Normalization is total (never rejects) — malformed/over-limit input is
  cleaned, not errored.
- Port skip is a pure, deterministic function of the tracked instance count and
  the definition's ports; no new failure modes on the launch path.

## Testing

Following the existing 1:1 `tests/` mirror and current patterns:

- **Store** (`tests/main/store/…`): `instance_tag` write/replace, normalization,
  and GC cascade on `deleteInstanceMeta`.
- **Launch / translate** (`tests/main/sbx/…`, mirroring `translate-ports` /
  `adapter-ports`): subsequent-launch port filtering (fixed dropped, ephemeral
  kept; first instance unchanged) and tag-folded name composition + length cap.
- **Reconcile** (`tests/main/…`): tags attached to `InstanceView`; GC removes tags.
- **Renderer:** LaunchDialog tag input + skip note (`tests/renderer/OpenWith`/
  `LaunchDialog`-style), Instances tag chips + OR-filter, Instance Detail tag
  editor.

## Rollout / migration

- One additive schema migration (new `instance_tag` table, `user_version` bump).
  No backfill needed — pre-existing instances simply have no tags until edited.
- No change to definition storage or bundle format, so no import/export migration.
