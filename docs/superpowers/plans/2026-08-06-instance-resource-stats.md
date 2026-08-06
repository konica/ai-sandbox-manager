# Instance Resource Stats (On-Demand) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "Fetch" button in the Monitoring tab that probes a running instance once and shows its CPU / memory / disk usage.

**Architecture:** One `sbx exec` probe reads cgroup + `df` inside the container (two CPU samples ~1s apart) and prints `key value` lines; a pure parser turns that into a `ResourceStats` object; a new IPC channel exposes it; the Monitoring tab renders a card with a Fetch button. No polling.

**Tech Stack:** TypeScript, React 18, Vitest (+ jsdom for renderer). `@shared`/`@main` path aliases.

## Global Constraints

- Run `npm run typecheck` (must be clean) and the SCOPED tests each task names. Every test in this plan uses fakes (`createSbxAdapter(fakeSpawn)`, `buildHandlers` with a fake adapter) — **none call `openStore`** — so they do NOT load `better-sqlite3` and run fine even while the dev app holds the electron ABI. Do NOT run the full `npm test`.
- Each metric is **independently nullable** — a missing/unreadable source yields `null` for just that metric ("Unavailable" in the UI), never a whole-probe failure. The probe script must NOT `set -e`-abort on one missing cgroup file.
- Container's own view only (cgroup + `df /`); no host metrics. CPU shown as "cores used" with "% of N CPUs" in a tooltip.
- On demand only — a Fetch button, no `setInterval` polling. Button disabled when `instance.status !== 'running'`.
- New user-facing strings go in BOTH `src/renderer/i18n/en.ts` and `de.ts`.

---

## File Structure

- **Create:** `src/shared/format-bytes.ts` — `formatBytes`. Test: `tests/shared/format-bytes.test.ts`.
- **Create:** `src/shared/resource-stats.ts` — `ResourceStats` type + `parseResourceStats`. Test: `tests/shared/resource-stats.test.ts`.
- **Create:** `src/main/sbx/resource-stats.ts` — the probe script constant + `fetchResourceStats`. Test: `tests/main/sbx/resource-stats.test.ts`.
- **Modify:** `src/main/sbx/adapter.ts` — add `execCapture`.
- **Modify:** `src/main/ipc.ts` — `instance:stats` handler + registration. Test: `tests/main/ipc-stats.test.ts`.
- **Modify:** `src/preload/index.ts`, `src/renderer/ipc/client.ts` — `instanceStats`.
- **Modify:** `src/renderer/screens/detail/MonitoringTab.tsx` — "Resource usage" card. Test: `tests/renderer/detail/MonitoringTab.test.tsx` (extend).
- **Modify:** `src/renderer/screens/InstanceDetail.tsx` — fetch wiring.
- **Modify:** `src/renderer/i18n/en.ts`, `de.ts` — new keys.

---

## Task 1: `formatBytes` shared helper (pure)

**Files:**
- Create: `src/shared/format-bytes.ts`
- Test: `tests/shared/format-bytes.test.ts`

**Interfaces:**
- Produces: `formatBytes(n: number): string`

- [ ] **Step 1: Write the failing test**

Create `tests/shared/format-bytes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatBytes } from '../../src/shared/format-bytes'

describe('formatBytes', () => {
  it('bytes under 1 KB (no decimal)', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })
  it('KB / MB / GB / TB with one decimal (1024-based)', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(312 * 1024 * 1024)).toBe('312.0 MB')
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB')
    expect(formatBytes(1.3 * 1024 ** 4)).toBe('1.3 TB')
  })
  it('negative / NaN → "0 B"', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/shared/format-bytes.test.ts`
Expected: FAIL — cannot find module `format-bytes`.

- [ ] **Step 3: Implement `src/shared/format-bytes.ts`**

```ts
/**
 * Human-readable byte size, 1024-based: "0 B", "512 B", "1.5 KB", "312.0 MB", "2.0 GB".
 * Bytes render with no decimal; KB and up with one. Negative/NaN/non-finite → "0 B".
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/shared/format-bytes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/format-bytes.ts tests/shared/format-bytes.test.ts
git commit -m "feat(format): formatBytes helper for human byte sizes"
```

---

## Task 2: `ResourceStats` type + `parseResourceStats` (pure)

**Files:**
- Create: `src/shared/resource-stats.ts`
- Test: `tests/shared/resource-stats.test.ts`

**Interfaces:**
- Produces:
  - `interface ResourceStats { cpu: { cores: number; ofCpus: number } | null; memory: { usedBytes: number; limitBytes: number | null } | null; disk: { totalBytes: number; usedBytes: number } | null }`
  - `parseResourceStats(stdout: string): ResourceStats`

- [ ] **Step 1: Write the failing test**

Create `tests/shared/resource-stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseResourceStats } from '../../src/shared/resource-stats'

const v2 = [
  'cpu_usec 1000000 1500000',   // Δ 500000 µs = 0.5 cpu-seconds
  'cpu_elapsed_ns 1000000000',  // 1.0 s
  'nproc 4',
  'mem_current 314572800',      // 300 MB
  'mem_max 2147483648',         // 2 GB
  'disk 10000000000 4000000000'
].join('\n')

describe('parseResourceStats', () => {
  it('parses a full cgroup-v2 sample', () => {
    const s = parseResourceStats(v2)
    expect(s.cpu).toEqual({ cores: 0.5, ofCpus: 4 })
    expect(s.memory).toEqual({ usedBytes: 314572800, limitBytes: 2147483648 })
    expect(s.disk).toEqual({ totalBytes: 10000000000, usedBytes: 4000000000 })
  })
  it('treats mem_max "max" as unlimited (limitBytes null)', () => {
    const s = parseResourceStats('mem_current 100\nmem_max max')
    expect(s.memory).toEqual({ usedBytes: 100, limitBytes: null })
  })
  it('cpu null when a cpu field is missing or elapsed is zero', () => {
    expect(parseResourceStats('nproc 4\nmem_current 1').cpu).toBeNull()
    expect(parseResourceStats('cpu_usec 1 2\ncpu_elapsed_ns 0\nnproc 4').cpu).toBeNull()
  })
  it('memory/disk null when their lines are missing', () => {
    const s = parseResourceStats('nproc 2')
    expect(s.memory).toBeNull()
    expect(s.disk).toBeNull()
  })
  it('all null for empty/garbage input', () => {
    const s = parseResourceStats('garbage\n\nnonsense line')
    expect(s).toEqual({ cpu: null, memory: null, disk: null })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/shared/resource-stats.test.ts`
Expected: FAIL — cannot find module `resource-stats`.

- [ ] **Step 3: Implement `src/shared/resource-stats.ts`**

```ts
/** Container resource snapshot. Each metric is null when its probe data was missing/unparseable. */
export interface ResourceStats {
  /** CPU used over the sample window, in cores (e.g. 0.7), plus nproc for a "% of N CPUs" view. */
  cpu: { cores: number; ofCpus: number } | null
  /** Memory used and the cgroup limit in bytes (limitBytes null = unlimited). */
  memory: { usedBytes: number; limitBytes: number | null } | null
  /** Container filesystem total and used bytes. */
  disk: { totalBytes: number; usedBytes: number } | null
}

function num(s: string | undefined): number | null {
  if (s === undefined) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function parseCpu(kv: Map<string, string>): ResourceStats['cpu'] {
  const [a, b] = (kv.get('cpu_usec') ?? '').split(/\s+/)
  const s0 = num(a); const s1 = num(b)
  const elapsedNs = num(kv.get('cpu_elapsed_ns'))
  const nproc = num(kv.get('nproc'))
  if (s0 === null || s1 === null || elapsedNs === null || elapsedNs <= 0 || nproc === null || nproc <= 0) return null
  const cores = Math.max(0, ((s1 - s0) / 1e6) / (elapsedNs / 1e9))
  return { cores, ofCpus: nproc }
}

function parseMemory(kv: Map<string, string>): ResourceStats['memory'] {
  const used = num(kv.get('mem_current'))
  if (used === null) return null
  const maxRaw = kv.get('mem_max')
  const limitBytes = maxRaw === undefined || maxRaw === 'max' ? null : num(maxRaw)
  return { usedBytes: used, limitBytes }
}

function parseDisk(kv: Map<string, string>): ResourceStats['disk'] {
  const [t, u] = (kv.get('disk') ?? '').split(/\s+/)
  const total = num(t); const used = num(u)
  if (total === null || used === null) return null
  return { totalBytes: total, usedBytes: used }
}

/**
 * Parse the container resource probe's `key value` stdout into ResourceStats.
 * Expected lines (each optional; a missing one → null for that metric):
 *   cpu_usec <s0> <s1> | cpu_elapsed_ns <ns> | nproc <n> |
 *   mem_current <bytes> | mem_max <bytes|max> | disk <totalBytes> <usedBytes>
 */
export function parseResourceStats(stdout: string): ResourceStats {
  const kv = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sp = trimmed.indexOf(' ')
    if (sp === -1) kv.set(trimmed, '')
    else kv.set(trimmed.slice(0, sp), trimmed.slice(sp + 1).trim())
  }
  return { cpu: parseCpu(kv), memory: parseMemory(kv), disk: parseDisk(kv) }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/shared/resource-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/resource-stats.ts tests/shared/resource-stats.test.ts
git commit -m "feat(stats): ResourceStats type + parseResourceStats probe parser"
```

---

## Task 3: adapter `execCapture` + `fetchResourceStats` orchestration

**Files:**
- Modify: `src/main/sbx/adapter.ts` (`SbxAdapter` interface L14-43; `execScript` impl ~L189-193; return object L206)
- Create: `src/main/sbx/resource-stats.ts`
- Test: `tests/main/sbx/resource-stats.test.ts`

**Interfaces:**
- Consumes: `parseResourceStats` (Task 2).
- Produces:
  - `SbxAdapter.execCapture(name: string, script: string): Promise<string>` (returns the exec's stdout).
  - `RESOURCE_PROBE_SCRIPT: string` and `fetchResourceStats(adapter: Pick<SbxAdapter, 'execCapture'>, name: string): Promise<ResourceStats>`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/sbx/resource-stats.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSbxAdapter, type SpawnFn } from '../../../src/main/sbx/adapter'
import { fetchResourceStats, RESOURCE_PROBE_SCRIPT } from '../../../src/main/sbx/resource-stats'

describe('execCapture', () => {
  it('runs `sbx exec <name> bash -lc <script>` and returns stdout', async () => {
    const spawn: SpawnFn = vi.fn(async () => ({ stdout: 'nproc 4\n', stderr: '', code: 0 }))
    const adapter = createSbxAdapter(spawn)
    const out = await adapter.execCapture('proj-a1', 'echo hi')
    expect(out).toBe('nproc 4\n')
    expect(spawn).toHaveBeenCalledWith('sbx', ['exec', 'proj-a1', 'bash', '-lc', 'echo hi'], expect.anything())
  })
})

describe('fetchResourceStats', () => {
  it('runs the probe script and parses the output', async () => {
    const stdout = 'cpu_usec 0 1000000\ncpu_elapsed_ns 1000000000\nnproc 2\nmem_current 100\nmem_max max\ndisk 10 4\n'
    const adapter = { execCapture: vi.fn(async () => stdout) }
    const stats = await fetchResourceStats(adapter, 'proj-a1')
    expect(adapter.execCapture).toHaveBeenCalledWith('proj-a1', RESOURCE_PROBE_SCRIPT)
    expect(stats.cpu).toEqual({ cores: 1, ofCpus: 2 })
    expect(stats.memory).toEqual({ usedBytes: 100, limitBytes: null })
    expect(stats.disk).toEqual({ totalBytes: 10, usedBytes: 4 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/sbx/resource-stats.test.ts`
Expected: FAIL — `adapter.execCapture` is not a function / module `resource-stats` not found.

- [ ] **Step 3: Add `execCapture` to the adapter**

In `src/main/sbx/adapter.ts`:

Add to the `SbxAdapter` interface, right after the `execScript` declaration (L42):

```ts
  /** Like execScript but returns the exec's stdout: `sbx exec <name> bash -lc <script>`. Throws on non-zero exit. */
  execCapture(name: string, script: string): Promise<string>
```

Add the implementation next to `execScript` (after L193):

```ts
  async function execCapture(name: string, script: string): Promise<string> {
    const res = await runSbx(['exec', name, 'bash', '-lc', script])
    return res.stdout
  }
```

Add `execCapture` to the returned object (L206), e.g. after `execScript`:

```ts
  return { runSbx, listSandboxes, createSandbox, applyPolicy, publishPorts, stopSandbox, removeSandbox, setSecret, removeSecret, listGlobalSecretsRaw, listInstanceSecretsRaw, setCustomSecret, removeCustomSecret, setRegistrySecret, removeRegistrySecret, listPorts, publishPort, unpublishPort, allowNetwork, removeNetwork, policyLog, checkDockerAuth, execScript, execCapture, validateKit }
```

- [ ] **Step 4: Create `src/main/sbx/resource-stats.ts`**

```ts
import type { ResourceStats } from '@shared/resource-stats'
import { parseResourceStats } from '@shared/resource-stats'
import type { SbxAdapter } from './adapter'

/**
 * Probe script run inside the container. Prints `key value` lines for CPU (two cgroup usage
 * samples ~1s apart + elapsed ns + nproc), memory (cgroup v2 then v1), and disk (df on /).
 * Each metric is emitted only if its source is readable, so one missing file degrades to a
 * null metric rather than aborting — do NOT add `set -e`.
 */
export const RESOURCE_PROBE_SCRIPT = [
  `read_cpu() { if [ -r /sys/fs/cgroup/cpu.stat ]; then awk '/^usage_usec/{print $2}' /sys/fs/cgroup/cpu.stat; elif [ -r /sys/fs/cgroup/cpuacct/cpuacct.usage ]; then n=$(cat /sys/fs/cgroup/cpuacct/cpuacct.usage 2>/dev/null); [ -n "$n" ] && echo $((n/1000)); fi; }`,
  `t0=$(date +%s%N); c0=$(read_cpu); sleep 1; t1=$(date +%s%N); c1=$(read_cpu)`,
  `[ -n "$c0" ] && [ -n "$c1" ] && echo "cpu_usec $c0 $c1"`,
  `echo "cpu_elapsed_ns $((t1 - t0))"`,
  `echo "nproc $(nproc 2>/dev/null || echo 1)"`,
  `if [ -r /sys/fs/cgroup/memory.current ]; then echo "mem_current $(cat /sys/fs/cgroup/memory.current)"; echo "mem_max $(cat /sys/fs/cgroup/memory.max)"; elif [ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ]; then echo "mem_current $(cat /sys/fs/cgroup/memory/memory.usage_in_bytes)"; echo "mem_max $(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"; fi`,
  `df -PB1 / 2>/dev/null | awk 'NR==2{print "disk", $2, $3}'`
].join('\n')

/** Run the probe inside <name> and parse the result. Adapter/SbxError propagates on exec failure. */
export async function fetchResourceStats(adapter: Pick<SbxAdapter, 'execCapture'>, name: string): Promise<ResourceStats> {
  const stdout = await adapter.execCapture(name, RESOURCE_PROBE_SCRIPT)
  return parseResourceStats(stdout)
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/main/sbx/resource-stats.test.ts`
Expected: PASS (execCapture returns stdout with the right argv; fetchResourceStats parses).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/sbx/adapter.ts src/main/sbx/resource-stats.ts tests/main/sbx/resource-stats.test.ts
git commit -m "feat(sbx): execCapture + fetchResourceStats container probe"
```

---

## Task 4: IPC `instance:stats` + preload + client

**Files:**
- Modify: `src/main/ipc.ts` (import; `buildHandlers` return-type block; handlers object; `registerIpc`)
- Modify: `src/preload/index.ts`, `src/renderer/ipc/client.ts`
- Test: `tests/main/ipc-stats.test.ts`

**Interfaces:**
- Consumes: `fetchResourceStats` (Task 3), `ResourceStats` (Task 2).
- Produces: IPC `instance:stats(name) → Result<ResourceStats>`; preload `instanceStats(name)`; client `api.instanceStats(name)`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/ipc-stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildHandlers } from '@main/ipc'

const probe = 'cpu_usec 0 2000000\ncpu_elapsed_ns 1000000000\nnproc 2\nmem_current 100\nmem_max 200\ndisk 10 4\n'

function deps(execCapture: (name: string, script: string) => Promise<string>) {
  return {
    adapter: { execCapture } as never,
    store: {} as never,
    probes: {} as never,
    openTerminal: () => {}
  }
}

describe('instance:stats', () => {
  it('returns parsed ResourceStats on success', async () => {
    const h = buildHandlers(deps(async () => probe))
    const res = await h['instance:stats']('proj-a1')
    expect(res.ok).toBe(true)
    expect(res.ok && res.data.cpu).toEqual({ cores: 2, ofCpus: 2 })
    expect(res.ok && res.data.memory).toEqual({ usedBytes: 100, limitBytes: 200 })
  })
  it('returns Result error when the probe throws', async () => {
    const h = buildHandlers(deps(async () => { throw new Error('not running') }))
    const res = await h['instance:stats']('proj-a1')
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error.message).toMatch(/not running/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/ipc-stats.test.ts`
Expected: FAIL — `h['instance:stats']` is not a function.

- [ ] **Step 3: Wire the handler in `src/main/ipc.ts`**

Add the import (near the other sbx imports, e.g. beside `agentAttachCommand`):

```ts
import { fetchResourceStats } from './sbx/resource-stats'
```

Add `ResourceStats` to the existing `@shared/types`… no — `ResourceStats` lives in `@shared/resource-stats`. Add an import:

```ts
import type { ResourceStats } from '@shared/resource-stats'
```

In the `buildHandlers` return-type block, add (near the other `instance:*` lines, e.g. after `instance:policyLog`):

```ts
  'instance:stats': (name: string) => Promise<Result<ResourceStats>>
```

In the handlers object, add (after the `instance:policyLog` handler):

```ts
    'instance:stats': (name) => wrap(() => fetchResourceStats(deps.adapter, name)),
```

In `registerIpc`, add (after the `instance:policyLog` registration):

```ts
  ipcMain.handle('instance:stats', (_e, name: string) => handlers['instance:stats'](name))
```

- [ ] **Step 4: Run the IPC test to verify it passes**

Run: `npx vitest run tests/main/ipc-stats.test.ts`
Expected: PASS (success returns parsed stats; a throwing probe → `Result.ok === false`).

- [ ] **Step 5: Add the preload method**

In `src/preload/index.ts`, add after `instancePolicyLog`:

```ts
  instanceStats: (name: string) => ipcRenderer.invoke('instance:stats', name),
```

- [ ] **Step 6: Add the client type + fallback**

In `src/renderer/ipc/client.ts`:

Add the import at the top:

```ts
import type { ResourceStats } from '@shared/resource-stats'
```

In the `Api` interface, after `instancePolicyLog`:

```ts
  instanceStats(name: string): Promise<Result<ResourceStats>>
```

In the fallback `?? { … }` object, add:

```ts
  instanceStats: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
```

- [ ] **Step 7: Typecheck + main tests**

Run: `npm run typecheck && npx vitest run tests/main/ipc-stats.test.ts tests/main/sbx/resource-stats.test.ts`
Expected: clean + PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc-stats.test.ts
git commit -m "feat(ipc): instance:stats channel for on-demand resource usage"
```

---

## Task 5: Monitoring-tab "Resource usage" card + InstanceDetail wiring

**Files:**
- Modify: `src/renderer/screens/detail/MonitoringTab.tsx`
- Modify: `src/renderer/screens/InstanceDetail.tsx`
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Test: `tests/renderer/detail/MonitoringTab.test.tsx` (extend)

**Interfaces:**
- Consumes: `formatBytes` (Task 1), `ResourceStats` (Task 2), `api.instanceStats` (Task 4).
- Produces: `MonitoringTab` gains `stats: ResourceStatsState`, `running: boolean`, `onFetchStats: () => void`; exported `type ResourceStatsState`.

- [ ] **Step 1: Add the i18n keys to both dicts**

In `src/renderer/i18n/en.ts`, inside the `detail` object, add:

```ts
    resourceUsage: 'Resource usage',
    fetchStats: 'Fetch',
    refreshStats: 'Refresh',
    statsFetching: 'Fetching…',
    statsRunningHint: 'Start the instance to fetch its resource usage.',
    statsError: 'Couldn’t fetch usage: {message}',
    statsAsOf: 'as of {time}',
    statCpu: 'CPU',
    statMemory: 'Memory',
    statDisk: 'Disk',
    statUnavailable: 'Unavailable',
    cpuOfCpus: '{pct}% of {n} CPUs',
    memNoLimit: 'no limit',
```

In `src/renderer/i18n/de.ts`, inside its `detail` object, add:

```ts
    resourceUsage: 'Ressourcennutzung',
    fetchStats: 'Abrufen',
    refreshStats: 'Aktualisieren',
    statsFetching: 'Wird abgerufen…',
    statsRunningHint: 'Starte die Instanz, um die Ressourcennutzung abzurufen.',
    statsError: 'Nutzung konnte nicht abgerufen werden: {message}',
    statsAsOf: 'Stand {time}',
    statCpu: 'CPU',
    statMemory: 'Speicher',
    statDisk: 'Festplatte',
    statUnavailable: 'Nicht verfügbar',
    cpuOfCpus: '{pct}% von {n} CPUs',
    memNoLimit: 'kein Limit',
```

- [ ] **Step 2: Write the failing MonitoringTab test**

First Read the existing `tests/renderer/detail/MonitoringTab.test.tsx`. Do TWO edits, do NOT wholesale-replace the file:

(a) `MonitoringTab` now has three new REQUIRED props, so add `stats={{ status: 'idle' }} running={true} onFetchStats={() => {}}` to EVERY existing `<MonitoringTab … />` render in the file (keeps the current cases compiling; no assertion changes).

(b) APPEND the new `describe` block below. Reuse whatever is already imported at the top — do NOT duplicate an `import { render, screen, fireEvent, vi … }` or a `MonitoringTab` import that already exists; add only what's missing (likely `fireEvent`/`vi` and a `PolicySummary` import if absent). Define `emptySummary`/`base` only if the file doesn't already have equivalents.

```tsx
// (imports already at top of file: render, screen, fireEvent, vi, MonitoringTab; add PolicySummary if missing)
const emptySummary: PolicySummary = { allowed: 0, blocked: 0, events: [] }
const base = { summary: emptySummary, onAllow: () => {}, onDeny: () => {} }

describe('MonitoringTab resource usage', () => {
  it('disables Fetch when the instance is not running', () => {
    render(<MonitoringTab {...base} running={false} stats={{ status: 'idle' }} onFetchStats={() => {}} />)
    expect((screen.getByRole('button', { name: 'Fetch' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('calls onFetchStats when Fetch is clicked (running)', () => {
    const onFetchStats = vi.fn()
    render(<MonitoringTab {...base} running={true} stats={{ status: 'idle' }} onFetchStats={onFetchStats} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    expect(onFetchStats).toHaveBeenCalled()
  })
  it('renders CPU/memory/disk tiles from ready stats, with "no limit" and "Unavailable"', () => {
    render(<MonitoringTab {...base} running={true} onFetchStats={() => {}}
      stats={{ status: 'ready', at: '2026-08-06T14:03:20.000Z', data: {
        cpu: { cores: 0.5, ofCpus: 4 },
        memory: { usedBytes: 314572800, limitBytes: null },
        disk: null
      } }} />)
    expect(screen.getByText('0.50 cores')).toBeTruthy()
    expect(screen.getByText(/300\.0 MB/)).toBeTruthy()
    expect(screen.getByText('no limit')).toBeTruthy()
    // disk was null → Unavailable appears at least once
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })
  it('shows the error message on a failed fetch', () => {
    render(<MonitoringTab {...base} running={true} onFetchStats={() => {}} stats={{ status: 'error', message: 'not running' }} />)
    expect(screen.getByText(/not running/)).toBeTruthy()
  })
})
```

Note: `300.0 MB` because `formatBytes(314572800)` = 314572800/1024/1024 = 300.0 MB.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/renderer/detail/MonitoringTab.test.tsx`
Expected: FAIL — `MonitoringTab` doesn't accept the new props / no resource card.

- [ ] **Step 4: Add the card to `MonitoringTab.tsx`**

In `src/renderer/screens/detail/MonitoringTab.tsx`:

Add imports at the top:

```ts
import { formatBytes } from '@shared/format-bytes'
import type { ResourceStats } from '@shared/resource-stats'
```

Add the exported state type (above the `MonitoringTab` function):

```ts
export type ResourceStatsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ResourceStats; at: string }
```

Change the `MonitoringTab` signature/props to add the three new props:

```ts
export function MonitoringTab({ summary, onAllow, onDeny, stats, running, onFetchStats }: {
  summary: PolicySummary
  onAllow: (host: string) => void
  onDeny: (host: string) => void
  stats: ResourceStatsState
  running: boolean
  onFetchStats: () => void
}): JSX.Element {
```

Render the card as the FIRST child inside the top-level `<div>` of the returned JSX (before the existing `<div className="mon-summary" …>`):

```tsx
      <ResourceCard stats={stats} running={running} onFetch={onFetchStats} t={t} />
```

Add the `ResourceCard` + `Tile` components at the bottom of the file (after `DomainGroup`):

```tsx
function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0
}

function ResourceCard({ stats, running, onFetch, t }: {
  stats: ResourceStatsState
  running: boolean
  onFetch: () => void
  t: (k: string, vars?: Record<string, string | number>) => string
}): JSX.Element {
  const btnLabel = stats.status === 'loading' ? t('detail.statsFetching')
    : stats.status === 'ready' ? t('detail.refreshStats') : t('detail.fetchStats')
  return (
    <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="card-title">{t('detail.resourceUsage')}</div>
        <button className="btn btn-secondary btn-sm" disabled={!running || stats.status === 'loading'} onClick={onFetch}>{btnLabel}</button>
      </div>
      {!running && <p className="section-desc" style={{ fontSize: 12, marginTop: 0 }}>{t('detail.statsRunningHint')}</p>}
      {stats.status === 'error' && <p className="section-desc" style={{ fontSize: 12, color: 'var(--danger)', marginTop: 0 }}>{t('detail.statsError', { message: stats.message })}</p>}
      {stats.status === 'ready' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', marginTop: 'var(--space-2)' }}>
            <Tile label={t('detail.statCpu')} value={stats.data.cpu ? `${stats.data.cpu.cores.toFixed(2)} cores` : t('detail.statUnavailable')}
              title={stats.data.cpu ? t('detail.cpuOfCpus', { pct: Math.round((stats.data.cpu.cores / stats.data.cpu.ofCpus) * 100), n: stats.data.cpu.ofCpus }) : undefined} />
            <Tile label={t('detail.statMemory')} value={stats.data.memory
              ? (stats.data.memory.limitBytes !== null
                  ? `${formatBytes(stats.data.memory.usedBytes)} / ${formatBytes(stats.data.memory.limitBytes)} (${pct(stats.data.memory.usedBytes, stats.data.memory.limitBytes)}%)`
                  : `${formatBytes(stats.data.memory.usedBytes)} · ${t('detail.memNoLimit')}`)
              : t('detail.statUnavailable')} />
            <Tile label={t('detail.statDisk')} value={stats.data.disk
              ? `${formatBytes(stats.data.disk.usedBytes)} / ${formatBytes(stats.data.disk.totalBytes)} (${pct(stats.data.disk.usedBytes, stats.data.disk.totalBytes)}%)`
              : t('detail.statUnavailable')} />
          </div>
          <p className="section-desc" style={{ fontSize: 11, marginTop: 'var(--space-2)', marginBottom: 0 }}>{t('detail.statsAsOf', { time: new Date(stats.at).toLocaleTimeString() })}</p>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, title }: { label: string; value: string; title?: string }): JSX.Element {
  return (
    <div className="mon-stat" title={title}>
      <span className="mon-stat-value" style={{ fontSize: 15 }}>{value}</span>
      <span className="mon-stat-label">{label}</span>
    </div>
  )
}
```

Note: for the memory "no limit" case the value string is `312.0 MB · no limit` — the test asserts the substrings `/300\.0 MB/` and `no limit` separately (both `getByText` with a regex / exact substring), so keep "no limit" as its own token from `t('detail.memNoLimit')`. If `getByText('no limit')` can't match because it's inside a larger string, the test uses `screen.getByText('no limit')` which matches by normalized text node — since the whole value is one text node, change the memory-tile "no limit" rendering to keep the label distinct is unnecessary; instead the test in Step 2 uses `screen.getByText('no limit')` — if that fails due to substring matching, adjust the test to `screen.getByText(/no limit/)`. Prefer the regex form in the test to be safe: it is already `screen.getByText('no limit')` — change to `screen.getByText(/no limit/)` if needed during Step 6.

- [ ] **Step 5: Wire the fetch in `InstanceDetail.tsx`**

In `src/renderer/screens/InstanceDetail.tsx`:

Add the import:

```ts
import type { ResourceStatsState } from './detail/MonitoringTab'
```

Add state near the other `useState` hooks:

```ts
  const [stats, setStats] = useState<ResourceStatsState>({ status: 'idle' })
```

Reset stats when the instance changes (add near the other effects):

```ts
  useEffect(() => { setStats({ status: 'idle' }) }, [instance.name])
```

Add the fetch handler (near the other handlers, before the return):

```ts
  async function onFetchStats(): Promise<void> {
    setStats({ status: 'loading' })
    const r = await api.instanceStats(instance.name)
    if (r.ok) setStats({ status: 'ready', data: r.data, at: new Date().toISOString() })
    else setStats({ status: 'error', message: r.error.message })
  }
```

Update the `<MonitoringTab … />` usage (in the `{tab === 'monitoring' && ( … )}` block) to pass the new props:

```tsx
        <MonitoringTab
          summary={{ allowed: policy.allowed, blocked: policy.blocked, events: trafficEvents }}
          stats={stats}
          running={running}
          onFetchStats={() => void onFetchStats()}
          onAllow={async (host) => {
            setHostOverride(host, 'allow')
            await api.instanceDomainAllow(instance.name, host)
            void reloadPolicy(); void reloadSpec()
          }}
          onDeny={async (host) => {
            setHostOverride(host, 'deny')
            await api.instanceDomainDeny(instance.name, host)
            void reloadPolicy(); void reloadSpec()
          }}
        />
```

(`running` already exists in `InstanceDetail` — `const running = instance.status === 'running'`.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/detail/MonitoringTab.test.tsx`
Expected: PASS. If `getByText('no limit')` fails to match (it's part of a larger text node), change that assertion to `screen.getByText(/no limit/)` and re-run.

- [ ] **Step 7: Typecheck + full renderer suite**

Run: `npm run typecheck && npx vitest run tests/renderer`
Expected: typecheck clean; renderer suite green. If `MonitoringTab` is rendered by any OTHER existing test (e.g. an InstanceDetail integration test) that now lacks the new required props, add `stats={{ status: 'idle' }} running={…} onFetchStats={() => {}}` there minimally.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/screens/detail/MonitoringTab.tsx src/renderer/screens/InstanceDetail.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/detail/MonitoringTab.test.tsx
git commit -m "feat(ui): on-demand resource usage card in the Monitoring tab"
```

---

## Self-Review

**Spec coverage:**
- Capturing `execCapture` + one probe → Task 3 (adapter + script).
- Two-sample CPU delta, cgroup v2→v1 fallback, per-metric degradation, `df /` → Task 3 script + Task 2 parser (nullable metrics).
- `ResourceStats` type + parser + `formatBytes` → Tasks 1, 2.
- `instance:stats` IPC + preload + client → Task 4.
- Monitoring-tab card, on-demand Fetch button, running-gate, loading/error/ready states, CPU "cores"/tooltip, memory limit vs "no limit", disk %, "as of" time → Task 5.
- i18n keys in both dicts → Task 5.
- Tests across shared/main/renderer, all fake-based (no `openStore`) → every task.

**Placeholder scan:** none — every step carries real code. (Two implementation notes flag a possible `getByText('no limit')` → `/no limit/` test tweak; that is a concrete, resolvable instruction, not a placeholder.)

**Type consistency:** `ResourceStats` shape identical across Task 2 (def), Task 3 (`fetchResourceStats` return), Task 4 (IPC/client types), Task 5 (`ResourceStatsState.data`). `formatBytes(n)`, `parseResourceStats(stdout)`, `fetchResourceStats(adapter, name)`, `execCapture(name, script)`, and `api.instanceStats(name)` signatures match between their defining task and every consuming task. `ResourceStatsState` is defined and exported in Task 5's `MonitoringTab.tsx` and imported by `InstanceDetail.tsx`.
