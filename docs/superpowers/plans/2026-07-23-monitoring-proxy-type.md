# Proxy Type on the Monitoring Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface each request's `proxy_type` (from `sbx policy log`) on the Monitoring tab — as a color-coded, tooltipped badge in the Live Traffic table and the Domain Requests groups — plus a collapsible legend explaining the five proxy types.

**Architecture:** `sbx policy log --json` already returns a `proxy_type` per row; the parser currently drops it. Thread it through `PolicyEvent.proxyType`, add a shared tone/i18n-key metadata module, and render a `ProxyBadge` + legend in `MonitoringTab`. No new sbx call, no new IPC surface.

**Tech Stack:** TypeScript (strict), React 18, Vitest + @testing-library/react (jsdom). Custom i18n (`de: Dict = typeof en` enforces key parity at typecheck).

## Global Constraints

- **i18n parity:** every key added to `src/renderer/i18n/en.ts` MUST be added to `de.ts` — `typecheck` fails otherwise. Both files, same keys.
- **`@shared/*`** path alias maps to `src/shared/*` (works in main and renderer).
- **No new IPC / no new sbx invocation.** `instance:policyLog` shape is unchanged; only `PolicyEvent` gains a field.
- **Unknown/empty `proxy_type` never breaks the UI:** empty → no badge; unknown value → raw string, neutral tone, generic tooltip.
- **Tone is semantic, separate from the ✓/✕ allowed color.** Tones: `forward`=ok, `forward-bypass`/`transparent`=warn, `network`=neutral, `browser-open`=info.
- Docs link target: `https://docs.docker.com/ai/sandboxes/governance/monitoring/#monitoring-traffic`.

---

### Task 1: Parse `proxy_type` into `PolicyEvent`

**Files:**
- Modify: `src/shared/types.ts` (PolicyEvent)
- Modify: `src/main/sbx/policy-log.ts`
- Test: `tests/main/sbx/policy-log.test.ts`

**Interfaces:**
- Produces: `PolicyEvent.proxyType: string` — raw `proxy_type` value, or `''` when absent.

- [ ] **Step 1: Extend the failing test**

In `tests/main/sbx/policy-log.test.ts`, add `proxy_type` to the `sample` fixture rows and assert it is parsed. Add these to the existing `describe`:

```ts
// In the `sample` object, add proxy_type to each row:
//   blocked_hosts[0]: add `proxy_type: 'forward-bypass',`
//   allowed_hosts[0]: add `proxy_type: 'forward',`

  it('parses proxy_type into each event (allowed + blocked)', () => {
    const s = parsePolicyLog(sample)
    expect(s.events.find((e) => e.host.includes('api.anthropic.com'))?.proxyType).toBe('forward')
    expect(s.events.find((e) => e.host.includes('telemetry'))?.proxyType).toBe('forward-bypass')
  })
  it('defaults proxyType to "" when the field is absent', () => {
    const s = parsePolicyLog(JSON.stringify({ allowed_hosts: [{ host: 'x.com:443', last_seen: 'a', count_since: 1 }], blocked_hosts: [] }))
    expect(s.events[0].proxyType).toBe('')
  })
```

Update the `sample` constant so its two rows include the `proxy_type` values above:

```ts
const sample = JSON.stringify({
  blocked_hosts: [
    { host: 'telemetry.example.com:443', vm_name: 'box', proxy_type: 'forward-bypass', reason: 'No matching allow rule (default deny)', last_seen: '2026-07-19T21:42:54+07:00', count_since: 2 }
  ],
  allowed_hosts: [
    { host: 'api.anthropic.com:443', vm_name: 'box', proxy_type: 'forward', reason: 'domain-allowed', last_seen: '2026-07-19T21:42:20+07:00', count_since: 5 }
  ]
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- policy-log`
Expected: FAIL — `proxyType` is `undefined` / property does not exist on the parsed event type.

- [ ] **Step 3: Add `proxyType` to `PolicyEvent`**

In `src/shared/types.ts`, the `PolicyEvent` interface (currently ends `reason: string` then `count: number`) becomes:

```ts
/** One row of `sbx policy log` (allowed or blocked outbound request). */
export interface PolicyEvent {
  at: string
  host: string
  allowed: boolean
  reason: string
  proxyType: string // proxy handling: forward | forward-bypass | transparent | network | browser-open | '' (absent/unknown)
  count: number // requests to this host since it was first seen
}
```

- [ ] **Step 4: Read `proxy_type` in the parser**

In `src/main/sbx/policy-log.ts`:

Add `proxy_type` to `RawRow`:
```ts
interface RawRow { host?: unknown; reason?: unknown; last_seen?: unknown; count_since?: unknown; proxy_type?: unknown }
```

In `toEvents`, extend the pushed event:
```ts
    events.push({ at: typeof o.last_seen === 'string' ? o.last_seen : '', host, allowed, reason: typeof o.reason === 'string' ? o.reason : '', proxyType: typeof o.proxy_type === 'string' ? o.proxy_type : '', count: n })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- policy-log`
Expected: PASS (all cases, including the two new ones).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean (no other `PolicyEvent` literal needs `proxyType` — the parser is the only constructor; the renderer test fixture is updated in Task 3).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/sbx/policy-log.ts tests/main/sbx/policy-log.test.ts
git commit -m "feat(monitoring): parse proxy_type from sbx policy log"
```

---

### Task 2: Shared proxy-type metadata + i18n

**Files:**
- Create: `src/shared/proxy-types.ts`
- Test: `tests/shared/proxy-types.test.ts`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/de.ts`

**Interfaces:**
- Produces:
  - `PROXY_TYPES: readonly string[]` — ordered `['forward','forward-bypass','transparent','network','browser-open']`.
  - `proxyTone(type: string): 'ok' | 'warn' | 'neutral' | 'info'` (default `'neutral'`).
  - `proxyLabelKey(type: string): string | null` — i18n key for the friendly label, or `null` for unknown/empty.
  - `proxyMeaningKey(type: string): string | null` — i18n key for the meaning, or `null`.
  - i18n keys under `detail`: `colProxy`, `proxyLegendTitle`, `proxyLegendLearnMore`, `proxyUnknownMeaning`, and per type `proxy{Slug}Label` / `proxy{Slug}Meaning` where Slug ∈ {Forward, ForwardBypass, Transparent, Network, BrowserOpen}.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/proxy-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PROXY_TYPES, proxyTone, proxyLabelKey, proxyMeaningKey } from '../../src/shared/proxy-types'

describe('proxy-types', () => {
  it('maps known types to tones', () => {
    expect(proxyTone('forward')).toBe('ok')
    expect(proxyTone('forward-bypass')).toBe('warn')
    expect(proxyTone('transparent')).toBe('warn')
    expect(proxyTone('network')).toBe('neutral')
    expect(proxyTone('browser-open')).toBe('info')
  })
  it('defaults unknown/empty types to neutral', () => {
    expect(proxyTone('whatever')).toBe('neutral')
    expect(proxyTone('')).toBe('neutral')
  })
  it('lists the five canonical types in order for the legend', () => {
    expect(PROXY_TYPES).toEqual(['forward', 'forward-bypass', 'transparent', 'network', 'browser-open'])
  })
  it('maps known types to i18n key slugs; unknown/empty → null', () => {
    expect(proxyLabelKey('forward')).toBe('detail.proxyForwardLabel')
    expect(proxyLabelKey('forward-bypass')).toBe('detail.proxyForwardBypassLabel')
    expect(proxyMeaningKey('browser-open')).toBe('detail.proxyBrowserOpenMeaning')
    expect(proxyLabelKey('nope')).toBeNull()
    expect(proxyMeaningKey('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- proxy-types`
Expected: FAIL — cannot resolve `../../src/shared/proxy-types`.

- [ ] **Step 3: Create the module**

Create `src/shared/proxy-types.ts`:

```ts
// Single source of truth for proxy-type presentation on the Monitoring tab.
// The `proxy_type` values come from `sbx policy log` (see the Docker monitoring docs).
// This module owns only the tone mapping and the canonical ordered list; friendly
// labels and meanings live in i18n (keyed by the slugs below) so both languages stay in sync.

export type ProxyTone = 'ok' | 'warn' | 'neutral' | 'info'

/** Canonical ordered list of known proxy types — used to render the legend. */
export const PROXY_TYPES: readonly string[] = ['forward', 'forward-bypass', 'transparent', 'network', 'browser-open']

const TONES: Record<string, ProxyTone> = {
  forward: 'ok',
  'forward-bypass': 'warn',
  transparent: 'warn',
  network: 'neutral',
  'browser-open': 'info'
}

/** Semantic tone for a proxy type; unknown/empty → 'neutral'. */
export function proxyTone(type: string): ProxyTone {
  return TONES[type] ?? 'neutral'
}

// Raw proxy_type → i18n key slug (PascalCase).
const SLUGS: Record<string, string> = {
  forward: 'Forward',
  'forward-bypass': 'ForwardBypass',
  transparent: 'Transparent',
  network: 'Network',
  'browser-open': 'BrowserOpen'
}

/** i18n key for a proxy type's friendly label, or null for unknown/empty. */
export function proxyLabelKey(type: string): string | null {
  const s = SLUGS[type]
  return s ? `detail.proxy${s}Label` : null
}

/** i18n key for a proxy type's plain-language meaning, or null for unknown/empty. */
export function proxyMeaningKey(type: string): string | null {
  const s = SLUGS[type]
  return s ? `detail.proxy${s}Meaning` : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- proxy-types`
Expected: PASS.

- [ ] **Step 5: Add i18n keys (English)**

In `src/renderer/i18n/en.ts`, the `detail` block currently ends:
```ts
    colHost: 'Host',
    colReason: 'Reason'
  },
```
Replace with (note the added comma after `'Reason'`):
```ts
    colHost: 'Host',
    colReason: 'Reason',
    colProxy: 'Proxy',
    proxyLegendTitle: 'Proxy types',
    proxyLegendLearnMore: 'Learn more',
    proxyUnknownMeaning: 'Handled by the sandbox proxy.',
    proxyForwardLabel: 'Forward',
    proxyForwardMeaning: 'Forward proxy — supports credential injection.',
    proxyForwardBypassLabel: 'Forward (bypass)',
    proxyForwardBypassMeaning: 'Forward proxy without credential injection.',
    proxyTransparentLabel: 'Transparent',
    proxyTransparentMeaning: 'Transparent proxy — policy enforced, no credential injection.',
    proxyNetworkLabel: 'Network',
    proxyNetworkMeaning: 'Non-HTTP traffic (raw TCP/UDP/ICMP). UDP and ICMP are always blocked.',
    proxyBrowserOpenLabel: 'Browser open',
    proxyBrowserOpenMeaning: 'A sandbox process requested opening a URL in the host browser.'
  },
```

- [ ] **Step 6: Add i18n keys (German)**

In `src/renderer/i18n/de.ts`, the `detail` block currently ends:
```ts
    colHost: 'Host',
    colReason: 'Grund'
  },
```
Replace with:
```ts
    colHost: 'Host',
    colReason: 'Grund',
    colProxy: 'Proxy',
    proxyLegendTitle: 'Proxy-Typen',
    proxyLegendLearnMore: 'Mehr erfahren',
    proxyUnknownMeaning: 'Vom Sandbox-Proxy verarbeitet.',
    proxyForwardLabel: 'Forward',
    proxyForwardMeaning: 'Forward-Proxy — unterstützt Credential-Injektion.',
    proxyForwardBypassLabel: 'Forward (Bypass)',
    proxyForwardBypassMeaning: 'Forward-Proxy ohne Credential-Injektion.',
    proxyTransparentLabel: 'Transparent',
    proxyTransparentMeaning: 'Transparenter Proxy — Richtlinie erzwungen, keine Credential-Injektion.',
    proxyNetworkLabel: 'Netzwerk',
    proxyNetworkMeaning: 'Nicht-HTTP-Verkehr (rohes TCP/UDP/ICMP). UDP und ICMP werden immer blockiert.',
    proxyBrowserOpenLabel: 'Browser öffnen',
    proxyBrowserOpenMeaning: 'Ein Sandbox-Prozess wollte eine URL im Host-Browser öffnen.'
  },
```

- [ ] **Step 7: Typecheck (i18n parity)**

Run: `npm run typecheck`
Expected: clean — proves en/de key sets match (`de: Dict = typeof en`).

- [ ] **Step 8: Commit**

```bash
git add src/shared/proxy-types.ts tests/shared/proxy-types.test.ts src/renderer/i18n/en.ts src/renderer/i18n/de.ts
git commit -m "feat(monitoring): proxy-type tone map + i18n labels/meanings"
```

---

### Task 3: Render the badge, column, and legend in MonitoringTab

**Files:**
- Modify: `src/renderer/screens/detail/MonitoringTab.tsx`
- Modify: `src/renderer/theme/app.css`
- Test: `tests/renderer/detail/MonitoringTab.test.tsx`

**Interfaces:**
- Consumes: `PolicyEvent.proxyType` (Task 1); `proxyTone`, `proxyLabelKey`, `proxyMeaningKey`, `PROXY_TYPES` (Task 2); i18n keys (Task 2).

- [ ] **Step 1: Update the test fixture + add failing tests**

In `tests/renderer/detail/MonitoringTab.test.tsx`, update the shared `summary` events to carry `proxyType`, and add three tests. New `summary`:

```ts
const summary = {
  allowed: 42, blocked: 5, events: [
    { at: '2026-07-19T10:15:23', host: 'api.anthropic.com:443', allowed: true, reason: 'domain-allowed', proxyType: 'forward', count: 40 },
    { at: '2026-07-19T10:15:15', host: 'telemetry.example.com:443', allowed: false, reason: 'default deny', proxyType: 'forward-bypass', count: 7 }
  ]
}
```

Add inside the `describe`:

```ts
  it('shows the proxy type as a badge with an explanatory tooltip', () => {
    render(<MonitoringTab summary={summary} {...base} />)
    const forward = screen.getAllByText('Forward')
    expect(forward.length).toBeGreaterThanOrEqual(1)
    expect(forward[0]).toHaveAttribute('title', expect.stringContaining('credential injection'))
  })
  it('color-codes the proxy tone (forward-bypass = warn)', () => {
    render(<MonitoringTab summary={summary} {...base} />)
    const bypass = screen.getAllByText('Forward (bypass)')
    expect(bypass.some((el) => el.className.includes('proxy-badge') && el.className.includes('warn'))).toBe(true)
  })
  it('renders the proxy-types legend with all five entries and a docs link', () => {
    render(<MonitoringTab summary={summary} {...base} />)
    expect(screen.getByText('Proxy types')).toBeInTheDocument()
    expect(screen.getByText('Transparent')).toBeInTheDocument()
    expect(screen.getByText('Network')).toBeInTheDocument()
    expect(screen.getByText('Browser open')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /learn more/i })).toHaveAttribute('href', expect.stringContaining('docs.docker.com'))
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- MonitoringTab`
Expected: FAIL — no "Forward" badge / no "Proxy types" legend rendered yet.

- [ ] **Step 3: Add imports + `ProxyBadge` to MonitoringTab**

In `src/renderer/screens/detail/MonitoringTab.tsx`, after the existing imports add:

```ts
import { PROXY_TYPES, proxyTone, proxyLabelKey, proxyMeaningKey } from '@shared/proxy-types'
```

Add this component near the top (before `MonitoringTab`):

```tsx
/** A proxy-type pill: friendly label + tone color + meaning tooltip. Empty type → nothing. */
function ProxyBadge({ type }: { type: string }): JSX.Element | null {
  const t = useT()
  if (!type) return null
  const labelKey = proxyLabelKey(type)
  const meaningKey = proxyMeaningKey(type)
  return (
    <span className={`proxy-badge ${proxyTone(type)}`} title={meaningKey ? t(meaningKey) : t('detail.proxyUnknownMeaning')}>
      {labelKey ? t(labelKey) : type}
    </span>
  )
}
```

- [ ] **Step 4: Add the Proxy column to the Live Traffic table**

In the `<thead>` row, add a Proxy header between Host and Reason:
```tsx
                  <th style={{ textAlign: 'left', fontWeight: 600 }}>{t('detail.colHost')}</th>
                  <th style={{ textAlign: 'left', fontWeight: 600 }}>{t('detail.colProxy')}</th>
                  <th style={{ textAlign: 'left', fontWeight: 600 }}>{t('detail.colReason')}</th>
```

In the `<tbody>` map, add a Proxy cell between the host cell and the reason cell:
```tsx
                    <td className="traffic-domain">{e.host}</td>
                    <td><ProxyBadge type={e.proxyType} /></td>
                    <td className="traffic-rule" style={{ color: 'var(--text-muted)', fontSize: 11 }}>{e.reason}</td>
```

- [ ] **Step 5: Show the badge in the Domain Requests groups**

Change `DomainGroup`'s `rows` prop type to include `proxyType`:
```tsx
function DomainGroup({ label, rows, allowed, onAct, actLabel, t }: {
  label: string
  rows: { host: string; count: number; proxyType: string }[]
  allowed: boolean
  onAct: (host: string) => void
  actLabel: string
  t: (k: string) => string
}): JSX.Element {
```

In the row render, add the badge between the host span and the count span:
```tsx
            <span style={{ flex: '1 1 auto', fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.host}>{r.host}</span>
            <ProxyBadge type={r.proxyType} />
            <span title={t('detail.requestsTooltip')} style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{r.count}</span>
```

(`allowedList`/`blockedList` are already `PolicyEvent[]`, so each row carries `proxyType` — no mapping change needed at the call sites.)

- [ ] **Step 6: Add the legend**

Immediately before the final closing `</div>` of `MonitoringTab`'s returned JSX (after the Domain Requests `{summary.events.length > 0 && (…)}` block), add:

```tsx
      <details className="proxy-legend">
        <summary>{t('detail.proxyLegendTitle')}</summary>
        <div className="proxy-legend-body">
          {PROXY_TYPES.map((p) => (
            <div key={p} className="proxy-legend-row">
              <ProxyBadge type={p} />
              <span className="section-desc" style={{ fontSize: 12, margin: 0 }}>{t(proxyMeaningKey(p) as string)}</span>
            </div>
          ))}
          <a href="https://docs.docker.com/ai/sandboxes/governance/monitoring/#monitoring-traffic" target="_blank" rel="noreferrer">{t('detail.proxyLegendLearnMore')} →</a>
        </div>
      </details>
```

- [ ] **Step 7: Add badge + legend CSS**

Append to `src/renderer/theme/app.css`:

```css
/* Proxy-type badges + legend (Monitoring tab) */
.proxy-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
}
.proxy-badge.ok      { color: var(--success);    background: var(--success-bg); }
.proxy-badge.warn    { color: var(--warning);    background: var(--warning-bg); }
.proxy-badge.info    { color: var(--info);       background: var(--accent-muted); }
.proxy-badge.neutral { color: var(--text-muted); background: rgba(127, 127, 127, 0.12); }

.proxy-legend { margin-top: var(--space-5); font-size: 12px; }
.proxy-legend summary { cursor: pointer; color: var(--text-muted); font-weight: 600; }
.proxy-legend-body { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-3); }
.proxy-legend-row { display: flex; align-items: center; gap: var(--space-3); }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- MonitoringTab`
Expected: PASS (all existing tests + the three new ones).

- [ ] **Step 9: Typecheck + full suite + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all tests pass, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/screens/detail/MonitoringTab.tsx src/renderer/theme/app.css tests/renderer/detail/MonitoringTab.test.tsx
git commit -m "feat(monitoring): show proxy type badge + legend on the Monitoring tab"
```

---

## Self-Review

- **Spec coverage:** Task 1 = data (parse `proxy_type`); Task 2 = shared tone/i18n metadata + legend source; Task 3 = badge in Live Traffic table + Domain Requests groups + collapsible legend + docs link + CSS. All spec sections covered.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `proxyType` (camelCase field) vs `proxy_type` (raw JSON) used consistently; `proxyTone`/`proxyLabelKey`/`proxyMeaningKey`/`PROXY_TYPES` names match between Task 2 (produce) and Task 3 (consume); i18n slugs (Forward/ForwardBypass/Transparent/Network/BrowserOpen) consistent across module + en + de.
- Out of scope (per spec): proxy-type filtering, the `rule` field, filesystem logs, counter/action changes.
