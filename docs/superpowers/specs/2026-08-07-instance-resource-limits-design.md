# Design: Per-Definition CPU & Memory Limits

**Date:** 2026-08-07
**Status:** Approved — ready for implementation plan

## Problem

The product manager wants users to configure resource limits (CPU, memory) on
sandboxes, and asked whether limits can be adjusted after a sandbox is created.

## Research: what `sbx` actually supports (v0.35.0)

Verified directly against the installed `sbx` CLI.

**The complete resource surface — two flags, only on `create` and `run`:**

| Flag | Meaning | Default |
|------|---------|---------|
| `--cpus int` | Number of CPUs (this *is* the "cores" control — there is no separate cores flag) | `0` = auto, all host CPUs |
| `-m, --memory string` | Memory limit in binary units (`1024m`, `8g`) | 50% of host memory, capped at 32 GiB |

There is no swap, PIDs, block-I/O, or GPU flag in this version.

**Can limits be adjusted after creation? No — not through `sbx`.**

- The top-level command set (`create`, `run`, `stop`, `rm`, `ls`, `cp`, `exec`,
  `ports`, `policy`, `secret`, `template`, `ssh`, `kit`, `daemon`, `diagnose`, …)
  has **no** `update` / `set` / `config` / `resize` command. Limits are a
  create-time-only concern.
- `--cpus`/`--memory` also appear on `sbx run`, but `run --name` re-attaches to an
  existing container (agent/spec "read from its spec"), so those flags govern
  first creation, not resizing a live container.
- `sbx stop` takes no flags; `sbx ls --json` does **not** report a sandbox's
  cpu/memory — the app cannot even read back what a sandbox was created with.
- The only `sbx`-native way to change a sandbox's limits is destroy + recreate
  (`rm` then create with new flags). The workspace is bind-mounted, so code on
  disk survives; anything living only inside the container (installed packages,
  uncommitted state) does not.

Docker itself can hot-resize via `docker update --cpus/--memory`, but that bypasses
`sbx` entirely and is out of scope for this control plane.

## Scope decision

**Create-time only.** CPU and memory are configured on the Definition and baked in
at create time. To change an instance, the user relaunches. No fiction about
editing a live sandbox, and it matches the CLI exactly.

## Design

### 1. Data model

Add two **optional** fields to the persisted `Definition` (`src/shared/types.ts`),
mirroring how `baseImage`/`tier` already live there:

- `cpus?: number` — positive integer CPU count
- `memory?: string` — sbx binary-unit string (e.g. `8g`, `1024m`)

`undefined`/absent means **do not pass the flag** → sbx applies its own default
(all CPUs / 50% RAM). This makes "blank" an intentional, well-defined state rather
than an invented cap.

**Persistence** (`src/main/store/db.ts`): two nullable columns via migration —

```sql
ALTER TABLE definition ADD COLUMN cpus INTEGER;
ALTER TABLE definition ADD COLUMN memory TEXT;
```

Wire the two columns into the definition and spec `INSERT`/`UPDATE`/`SELECT`
statements (the same statements that already carry `base_image`, `tier`,
`ssh_forward_agent`, `kit_commands_yaml`, etc.). No default value — `NULL` reads
back as absent.

### 2. Argv translation

`specToCreateArgs` (`src/main/sbx/translate.ts`) appends:

- `--cpus <n>` only when `definition.cpus` is a positive integer
- `-m <memory>` only when `definition.memory` is a non-empty string

`launchCommand` (the interactive terminal launch path) already delegates to
`specToCreateArgs`, so both the GUI-spawned `create` and the terminal launch pick
this up from a single code path — no second place to keep in sync.

### 3. UI — the wizard, not the launch dialog

Two optional inputs added to `CreateDefinition` (Step 2, beside the base image),
threaded through the existing draft plumbing (`src/renderer/wizard/draft.ts`):

- `Draft` gains `cpus: string` and `memory: string` (strings for input handling;
  empty string = unset).
- `draftReducer` gains `setField` cases for the two fields.
- `toSpec` converts: `cpus` → parsed positive integer or `undefined`; `memory` →
  trimmed non-empty string or `undefined`.
- `draftFromSpec` seeds the inputs from a stored definition for editing
  (number → string; `undefined` → `''`).

`LaunchDialog` stays untouched — consistent with `baseImage`/`tier` being
definition-level rather than per-launch. Placeholders state the sbx defaults
("auto — all CPUs", "50% of host RAM, max 32 GiB") so a blank field reads as
deliberate.

### 4. Validation

A shared pair of predicates (e.g. `isValidCpus`, `isValidMemory` in a shared module
so renderer and `toSpec` agree), used by the wizard for inline errors and
advance-gating so invalid input never reaches `sbx`:

- `cpus`: empty **or** a positive integer (`^\d+$`, value ≥ 1).
- `memory`: empty **or** `^\d+(\.\d+)?\s*[mMgG]$` (matches sbx's `1024m` / `8g`
  examples).

Invalid input shows an inline error and blocks save. Blank is always valid (= omit
the flag). We deliberately do **not** enforce sbx's 32 GiB default cap client-side —
that ceiling is the *default's* cap, not a hard limit on explicit values; let sbx be
the authority and surface its error via the existing `SbxError` path if it rejects.

### 5. Behavioral note (consequence of create-time-only scope)

Editing a definition's limits affects **future** launches only. It does **not**
resize sandboxes already created from that definition — the CLI cannot do so. The
wizard should carry a one-line note to that effect. To change an existing
instance's limits, the user relaunches (a new sandbox from the updated definition).

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `Definition` type | Carries `cpus?`/`memory?` | — |
| `db.ts` migration + statements | Persist/read the two columns | `Definition` |
| `translate.ts` `specToCreateArgs` | Emit `--cpus`/`-m` when set | `Definition` |
| `draft.ts` (`Draft`, `toSpec`, `draftFromSpec`, reducer) | Wizard state ↔ spec | validation predicates |
| shared validators | Format-check cpus/memory | — |
| `CreateDefinition` wizard | Collect + validate input, show default hints + behavioral note | draft, validators |

## Error handling

- Invalid input is caught client-side (validators) before submit — no `sbx` call.
- If an out-of-range-but-well-formed value reaches `sbx` (e.g. more memory than the
  host has), `sbx` errors non-zero → existing `SbxError`/`classifySbxError` path
  surfaces it unchanged. No new error handling required.
- Absent values omit the flag entirely — never `--cpus 0` or `-m ""`.

## Testing (TDD)

- `tests/main/sbx/translate*.test.ts`: `specToCreateArgs` appends `--cpus`/`-m`
  when set; omits each when blank; omits `--cpus` when zero/absent.
- Validator unit tests: representative valid and invalid cpus & memory strings.
- Draft tests: `toSpec` maps `cpus`/`memory` (including undefined when blank);
  `draftFromSpec` round-trips a definition that has both set and one that has
  neither.
- `tests/main/store/db.test.ts`: migration adds the columns; a definition/spec
  upsert then read preserves `cpus` and `memory` (and reads back `undefined` when
  never set).

## Out of scope

- In-place resize of a running sandbox (CLI can't; would require `docker update`
  outside `sbx`).
- Per-launch override in `LaunchDialog`.
- Swap / PIDs / block-I/O / GPU limits (no sbx flags exist).
- Size presets (Small/Medium/Large) — raw numbers only.
