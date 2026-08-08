# Configurable sandbox disk/volume size

**Status:** Approved (design)
**Date:** 2026-08-09

## Problem

A sandbox definition can already carry CPU and memory limits, but not the size of
the sandbox's block volume. `sbx` provisions a 50 GB sparse volume by default; some
workloads need more (large clones, model caches) and some users want less. The user
wants to (a) store a disk-size default on the definition and (b) adjust it in the
Launch dialog before a specific run.

## Mechanism: env var, not a CLI flag

This is the one way disk size differs from CPU/memory. CPU/memory become CLI flags
(`--cpus`, `-m`) appended in `specToCreateArgs`. Disk size has **no `sbx` CLI flag** —
`sbx` reads it only from the `DOCKER_SANDBOXES_DOCKER_SIZE` environment variable on the
process that runs `sbx create`:

```
DOCKER_SANDBOXES_DOCKER_SIZE=10g sbx run claude
```

(Docs: <https://docs.docker.com/ai/sandboxes/customize/templates/>. Default 50 GB,
sparse — only consumes host space as written. Value is a size string like `10g`.)

The real `sbx create` in this app is **not** spawned via `runSbx`. It is one step in
the `&&`-chained shell command that `launchCommand` builds and `openTerminal` runs in a
native terminal. So we inject the env var as an **inline prefix on the create step
only** — POSIX inline-env syntax scopes the assignment to that single command, which is
the only step that provisions the volume:

```
unset SSH_AUTH_SOCK ; DOCKER_SANDBOXES_DOCKER_SIZE=10g sbx create … && sbx ports … && sbx run …
```

This mirrors the existing `unset SSH_AUTH_SOCK ;` precedent in `launchCommand`, which
already manipulates the launch shell's environment. When no disk size is set, the prefix
is omitted entirely and `sbx` uses its 50 GB default.

`adapter.createSandbox` (the direct-`spawn` path) has **no production caller** — the
terminal `launchCommand` chain is the only path that provisions a volume — so there is a
single injection point. `createSandbox` is left untouched; if it is ever wired for
provisioning, it would pass the value via `spawn`'s `env` option (noted, not built).

## Components & boundaries

The definition-level default mirrors the CPU/memory feature layer for layer; the
launch-time override is new plumbing that CPU/memory deliberately skipped (it fits disk
because the value is an env var set per spawn, not a stored sandbox property).

| Layer | File | Change |
|---|---|---|
| Type | `src/shared/types.ts` | Add `diskSize?: string` to `Definition`. |
| Validator | `src/shared/resources.ts` | Add `isValidDiskSize` / `parseDiskSize`. |
| Store | `src/main/store/db.ts` | Migration v11→v12 adds `disk_size TEXT`; thread through read map, INSERTs, UPDATE, SELECT column lists. |
| Wizard | `src/renderer/wizard/CreateDefinition.tsx`, `draft.ts` | "Disk size" input beside CPU/memory; draft field `diskSize`, seeded in `draftFromSpec`, emitted in `toSpec`. |
| i18n | `src/renderer/i18n/en.ts`, `de.ts` | `diskSizeLabel` / `diskSizePlaceholder` / `diskSizeInvalid`. |
| defio | `src/main/defio/bundle.ts` | Re-validate `diskSize` on import; export rides along. |
| Launch UI | `src/renderer/components/LaunchDialog.tsx` | "Disk size" input pre-filled from definition; passes value through `onLaunch`. |
| Launch IPC | `src/preload/index.ts`, `src/main/ipc.ts` | Thread `diskSize` through `instance:launch`. |
| Launch core | `src/main/launch.ts`, `src/main/sbx/translate.ts` | Resolve effective disk size; inject env var on create step. |

## Validation & format

Disk size reuses the memory format so users learn one syntax:

- Regex (same as `MEMORY_RE`): `/^\d+(\.\d+)?\s*[mMgG]$/` — e.g. `50g`, `512m`.
- Empty = "use the Docker default" (omit the env var).
- `isValidDiskSize(s)`: empty or matches the regex.
- `parseDiskSize(s)`: normalized (lowercase unit, no spaces) or `undefined` when blank/invalid.

Placeholder shown in both wizard and launch dialog: `50g` (Docker's default), so the
field reads as "the size you'll get if you leave this alone."

## Definition-level default (layer detail)

- **Store migration** is a *new* guarded block (v11→v12), not a retrofit of the
  existing cpus/memory block: `if (!defCols.includes('disk_size')) ALTER TABLE definition
  ADD COLUMN disk_size TEXT;`. Read map: `diskSize: row.disk_size == null ? undefined :
  String(row.disk_size)`. Every INSERT/UPDATE/SELECT that lists `cpus, memory` also lists
  `disk_size` (coalesced to `null` on write).
- **Wizard**: input `id="def-disk-size"`, `inputMode` free text, dispatches `setField`
  field `'diskSize'`, inline `role="alert"` error via `!isValidDiskSize(draft.diskSize)`.
  Advance-gate for the step ANDs in `isValidDiskSize(d.diskSize)`; submit-time guard jumps
  back to the step on invalid, same as cpus/memory. Reuses the existing resources note.
- **Draft**: `diskSize: string` in the `Draft` type and empty draft (`''`); add to the
  `setField` action union; `draftFromSpec` → `spec.definition.diskSize ?? ''`; `toSpec` →
  `parseDiskSize(d.diskSize)`.
- **defio import** (`normalizeEntry`): `typeof def.diskSize === 'string' &&
  isValidDiskSize(def.diskSize) ? parseDiskSize(def.diskSize) : undefined` — untrusted
  JSON, drop bad values to `undefined` rather than failing the entry.

## Launch-time override (new plumbing)

- **LaunchDialog** gains a "Disk size" input pre-filled from `definition.diskSize ?? ''`,
  with the same inline validation. Whatever is in the box at submit is **authoritative for
  that run**: empty → Docker's 50 GB default; a value → overrides the definition for this
  launch only. The definition's stored default is never mutated here.
- **Threading**: `onLaunch(sessionName, opener, tags, diskSize)` →
  `instanceLaunch(definitionId, name, sessionName, opener, tags, diskSize)` (preload) →
  IPC `instance:launch` → `launchDefinition(deps, id, requestedName?, sessionName?,
  opener?, tags?, diskSizeOverride?)`.
- **`launchDefinition`** resolves the effective value:
  `const disk = diskSizeOverride !== undefined ? parseDiskSize(diskSizeOverride) :
  spec.definition.diskSize`, then `launchCommand(spec, name, sessionName, kitDir, ports,
  disk)`.
- **`launchCommand`** gains a `diskSize?: string` param and, when set, prefixes
  `DOCKER_SANDBOXES_DOCKER_SIZE=<size>` onto the create step (the value matches
  `SAFE_ARG`, but is quoted defensively).
- **`instance:rebuild`** calls `launchDefinition` with no override → falls back to the
  definition default, so a rebuild reproduces the definition's configured size. Consistent.

## Out of scope

- Resizing a live sandbox. `sbx` cannot resize an existing volume (same constraint the
  CPU/memory design accepted). "Adjust before running" is satisfied by the launch-dialog
  field, which affects the new instance's `sbx create`.
- Reading a live sandbox's actual volume size back (`sbx ls --json` does not report it).
- Wiring `adapter.createSandbox` for env injection (no production caller).

## Testing

- `resources` — `isValidDiskSize` / `parseDiskSize` (empty, `50g`, `512m`, spaces,
  invalid, bare integer rejected).
- `db` — persist and read `diskSize`; migration adds the column; `null` round-trips to
  `undefined`.
- `draft` — `draftFromSpec` seeds `diskSize`; `toSpec` parses it; advance-gate blocks on
  invalid.
- `bundle` — import keeps a valid `diskSize`, drops an invalid one to `undefined`; export
  carries it.
- `translate` — `launchCommand` prefixes the env var on the create step when disk size is
  set; omits it when unset; the prefix lands on `create`, not later steps.
- `launch` — `launchDefinition` threads the override into the command; no override falls
  back to the definition default.
- `LaunchDialog` — field pre-filled from `definition.diskSize`; submit passes the value
  through `onLaunch`; inline error on invalid.
- `ipc-lifecycle` — `instance:launch` forwards `diskSize` into `launchDefinition`.
- i18n — en/de key parity.
