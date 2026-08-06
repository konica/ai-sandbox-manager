# Design: Show instance created date (in the Metadata tab)

**Date:** 2026-08-06
**Status:** Approved (ready for implementation planning)

## Problem

Users want to see when a sandbox instance was created. The app stores a creation
timestamp (`instance_meta.createdAt`) but never surfaces it in the UI.

## Scope

This spec covers ONLY the created date. Live resource stats (CPU / memory / disk) were
deliberately split into a separate, later spec — there is no built-in `sbx`/`docker` stats
source, so that feature needs its own design pass (container `exec` probes, CPU deltas,
polling cost). Not in scope here.

## Data source & reliability

The only source is `instance_meta.createdAt` (an ISO-8601 string, always set on the row):

- **App-launched** instances (`createdByApp: true`) — a true creation timestamp, stamped at
  launch (`launch.ts` `upsertInstanceMeta`).
- **CLI-started / adopted** instances — stamped with the moment the app *first observed* the
  instance during reconcile adoption, NOT the real Docker creation time.
- **Unlinked** instances (running, no matchable definition, no metadata row) — no timestamp
  at all.

`sbx ls` reports no creation/uptime field, so there is no better live source. The value is
therefore **nullable and sometimes approximate**; the UI must handle "unknown" and must not
present the value as guaranteed-precise.

## Domain model

Add a nullable field to `InstanceView` (app metadata — it is NOT a `sbx ls` field, so it does
NOT go on `SbxInstance`):

```ts
export interface InstanceView extends SbxInstance {
  // …existing fields…
  /** ISO timestamp the app recorded for this instance (launch time, or first-observed for
   *  adopted/CLI instances). Null when the instance has no metadata row. */
  createdAt: string | null
}
```

## Reconciler threading

In `reconcile()` (`src/main/reconciler.ts`), populate `createdAt` from the per-instance
metadata. Subtlety: the reconciler *adopts* a definition-linkable instance that has no metadata
row by writing a fresh `instance_meta` (with `createdAt = now`), but the local `meta` variable
is not updated in that same pass. To avoid a one-poll delay before a just-adopted instance
shows its date, capture the effective timestamp into a local:

- Start from `meta?.createdAt ?? null`.
- In the adoption branch, set that local to the same `createdAt` value written to the store
  (`meta?.createdAt ?? new Date(nowMs).toISOString()`).
- Return that local as `createdAt` on the `InstanceView`.

No change to GC/drift logic; this only threads an existing value onto the returned view.

## Formatting helper

A pure, dependency-free helper for the relative label (unit-testable):

```ts
// src/shared/format-time.ts (or a suitable shared location)
/**
 * Human relative time for an ISO timestamp, e.g. "just now", "5 minutes ago",
 * "3 hours ago", "2 days ago". Returns null for null/empty/unparseable input so the
 * caller can render its own "unknown" text.
 */
export function formatRelativeTime(iso: string | null, now?: number): string | null
```

Behavior:
- Null / empty / unparseable → returns `null`.
- < 60s → "just now" (the whole sub-minute range, so no "0 minutes ago").
- Minutes / hours / days buckets with singular/plural ("1 minute ago" vs "5 minutes ago").
- Future timestamps (clock skew) → treat as "just now" (don't render negative ages).
- Exact thresholds and bucket boundaries are pinned by the unit tests.

## UI — Metadata tab only

Show a "Created" row in the Metadata tab (`MetadataTab`), NOT in the Instances list (the list
is already wide). The tab currently receives `{ tags, onChange }`; extend it to also receive
`createdAt: string | null`.

- Render a small labelled row: the label `t('detail.createdLabel')` ("Created") and the value
  `formatRelativeTime(createdAt)` as the visible text, with `title={<absolute local
  datetime>}` so hovering shows the precise time (`new Date(createdAt).toLocaleString()`).
- When `createdAt` is null (or `formatRelativeTime` returns null), show `t('detail.createdUnknown')`
  ("Unknown") with no tooltip.
- Placement: above or below the existing Tags section within the same tab — a compact
  metadata row, consistent with the tab's existing styling.

`InstanceDetail` already has `instance.createdAt` available (from the reconciled `InstanceView`);
pass it straight to `MetadataTab`. No new IPC, no polling — the value rides along with the
existing `instances:list` reconcile the detail view already consumes.

## i18n

Add to BOTH `src/renderer/i18n/en.ts` and `de.ts`, under `detail`:
- `createdLabel` — en "Created", de "Erstellt".
- `createdUnknown` — en "Unknown", de "Unbekannt".

## Error handling

No new failure modes. Null/invalid timestamps degrade to "Unknown". The value is read-only.

## Testing

- **Shared:** unit-test `formatRelativeTime` — just-now (<60s), minutes (singular + plural),
  hours, days, null input, empty string, unparseable string, and a future timestamp → "just now".
- **Main:** reconcile test — `createdAt` populated on the view from an existing meta row; and
  present immediately for a just-adopted instance (workspace-linked, no prior meta row) in the
  same reconcile pass.
- **Renderer:** `MetadataTab` renders "Created " + the relative label with an absolute-time
  `title` when `createdAt` is set, and "Unknown" (no tooltip) when null. Update the existing
  `MetadataTab`/`InstanceDetail.tags` tests for the new required `createdAt` prop (pass a value).

## Rollout

No migration — `createdAt` already exists on every `instance_meta` row. Pre-existing instances
show their stored timestamp (approximate for adopted ones, per the reliability note). Purely
additive; no backward-compatibility concerns.
