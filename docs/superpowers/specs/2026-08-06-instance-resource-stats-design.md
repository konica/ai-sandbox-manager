# Design: On-demand resource usage (CPU / memory / disk)

**Date:** 2026-08-06
**Status:** Approved (ready for implementation planning)

## Problem

Users want to see a running sandbox instance's resource usage (CPU, memory, disk). They do
**not** want live polling — just an on-demand button to fetch a point-in-time snapshot when
needed. There is no built-in `sbx`/`docker stats` source, so the numbers must be probed from
inside the container.

## Decisions (resolved during brainstorming)

- **Location:** a "Resource usage" card at the top of the existing **Monitoring** tab.
- **On demand, not live:** a Fetch button runs one probe and shows a snapshot with its
  timestamp. No `setInterval` polling. Re-click to refresh.
- **Metrics:** CPU, memory, disk — all three, with a **real CPU %** (accepts a ~1s fetch for
  the two-sample delta).
- **CPU display:** "cores used" (e.g. "0.7 cores"), with "% of N CPUs" in a tooltip.

## Non-goals

- No live/streaming stats, no background polling, no history/graphs.
- No host-level metrics — only the container's own view.
- No new args for the disk target (probe `df` on `/`, the container filesystem).

## Data acquisition — one container probe

A single `sbx exec <name> bash -lc '<script>'` gathers everything in ~1s. Add a **capturing**
adapter method (the existing `execScript` returns `Promise<void>` and discards stdout; the
underlying `runSbx`/`defaultSpawn` already capture it, so existing callers are untouched):

```ts
// SbxAdapter
execCapture(name: string, script: string): Promise<string>   // returns stdout; throws SbxError on non-zero exit
```

The probe script prints stable `key value` lines to stdout. Behavior:

- **CPU** — two cgroup `cpu.stat` `usage_usec` samples with `sleep 1` between them, plus
  `date +%s%N` before/after so the parser computes an accurate rate. Emits the two usage values,
  the elapsed nanoseconds, and `nproc`. cgroup v1 fallback: `cpuacct.usage` (nanoseconds → µs).
- **Memory** — cgroup v2 `memory.current` / `memory.max`; v1 fallback
  `memory.usage_in_bytes` / `memory.limit_in_bytes`. A `memory.max` of `"max"` means unlimited.
- **Disk** — `df -PB1 /` → total / used (bytes) of the container filesystem.

**Robustness:** try cgroup v2 first, then v1; if a metric's source is unreadable, the script
emits nothing for it (so that metric parses to `null` and shows "Unavailable"), rather than
failing the whole probe. The script must not `set -e`-abort on a single missing file.

Illustrative output shape (exact keys pinned by the parser tests):

```
cpu_usec <sample0> <sample1>
cpu_elapsed_ns <deltaNs>
nproc <n>
mem_current <bytes>
mem_max <bytes|max>
disk <totalBytes> <usedBytes>
```

## Parsing & types

A pure, dependency-free parser turns probe stdout into a typed result. Each metric is
independently nullable so partial data degrades gracefully.

```ts
// src/shared/resource-stats.ts (type + parser; pure, no Node/sbx deps)
export interface ResourceStats {
  /** Container CPU: cores used over the sample window, plus nproc for a "% of N CPUs" view. */
  cpu: { cores: number; ofCpus: number } | null
  /** Container memory: bytes used and the cgroup limit (null = unlimited). */
  memory: { usedBytes: number; limitBytes: number | null } | null
  /** Container filesystem: total and used bytes. */
  disk: { totalBytes: number; usedBytes: number } | null
}
export function parseResourceStats(stdout: string): ResourceStats
```

CPU math: `cores = ((sample1 - sample0) microseconds / 1e6) / (cpu_elapsed_ns / 1e9)`, clamped
at `>= 0`; `ofCpus = nproc`. Missing/zero-elapsed/unparseable CPU lines → `cpu: null`. Missing
memory lines → `memory: null`; `mem_max === "max"` → `limitBytes: null`. Missing/short disk
line → `disk: null`.

A shared byte formatter for display:

```ts
// src/shared/format-bytes.ts
export function formatBytes(n: number): string   // e.g. "312 MB", "2.0 GB", "0 B"
```

## Orchestration & IPC

A small main-process module owns the script constant and the fetch+parse:

```ts
// src/main/sbx/resource-stats.ts
export async function fetchResourceStats(
  adapter: Pick<SbxAdapter, 'execCapture'>, name: string
): Promise<ResourceStats>   // runs the probe script via execCapture, returns parseResourceStats(stdout)
```

IPC (mirrors `instance:policyLog`):
- Handler `instance:stats(name) → Result<ResourceStats>` in `src/main/ipc.ts` (wrapped by
  `wrap`), calling `fetchResourceStats(deps.adapter, name)`; registered in `registerIpc`.
- Preload `instanceStats(name)`; renderer client `Api.instanceStats(name): Promise<Result<ResourceStats>>`
  plus the fallback stub.

## UI — Monitoring tab, on demand

`MonitoringTab` gains a "Resource usage" card rendered ABOVE the existing traffic summary.
`MonitoringTab` stays presentational; `InstanceDetail` owns the fetch:

- `InstanceDetail` adds `statsState: { status: 'idle' | 'loading' | 'error'; data?: ResourceStats; at?: string }`
  (or equivalent) and an `onFetchStats` handler calling `api.instanceStats(instance.name)`.
  Passes `stats`, `statsLoading`, `statsError`, and `onFetchStats` (plus the fetched-at
  timestamp) to `MonitoringTab`. Reset stats when `instance.name` changes or the tab changes.
- The card:
  - A **Fetch** button (label "Fetch"; after a result, "Refresh"), **disabled when
    `instance.status !== 'running'`** (with a hint that the instance must be running).
  - Loading: a brief "Fetching…" state (~1s).
  - Result: three tiles — CPU (`{cores} cores`, `title` "= X% of N CPUs"), Memory
    (`{used} / {limit} ({pct}%)`, or `{used} (no limit)` when `limitBytes` is null), Disk
    (`{used} / {total} ({pct}%)`). A metric whose value is `null` shows
    `t('detail.statUnavailable')` ("Unavailable"). The fetched-at time is shown (e.g. "as of
    14:03:20").
  - Error: an inline error message from the `Result` error.

## Error handling

- Whole-probe failure (container stopped mid-fetch, exec/`SbxError`) → `Result` error → inline
  error in the card; no throw crosses IPC.
- Per-metric `null` → "Unavailable" on that tile; the other tiles still render.
- Button gated on `status === 'running'` so a stopped instance can't be probed.

## Testing

- **Shared:** `parseResourceStats` — a cgroup-v2 sample → full `ResourceStats`; a v1-style
  sample; `mem_max "max"` → `limitBytes: null`; missing CPU/mem/disk sections → the respective
  `null`; zero/negative elapsed → `cpu: null`; malformed input → all null. `formatBytes` — B/KB/MB/GB
  boundaries and 0.
- **Main:** `execCapture` returns the child's stdout (fake `SpawnFn`); `fetchResourceStats`
  runs the script through a fake adapter and returns the parsed result; the `instance:stats`
  IPC handler wraps success and error (fake adapter throwing → `Result.ok === false`).
- **Renderer:** `MonitoringTab` — Fetch button disabled when not running; renders the three
  tiles from provided stats (including "no limit" memory and "Unavailable" for null metrics);
  shows the loading and error states. Update existing `MonitoringTab` tests for the new props
  (pass an idle stats state so current assertions are unaffected).

## Rollout

Purely additive: a new adapter method, a new IPC channel, a new shared parser/formatter, and a
Monitoring-tab card. No schema, no migration, no change to existing instance data. Works only
for running instances; older/unusual cgroup layouts degrade to "Unavailable" per metric rather
than erroring.
