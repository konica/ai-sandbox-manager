# Proxy Type on the Monitoring Tab — Design

**Date:** 2026-07-23
**Status:** Approved (brainstorming)

## Goal

Surface the **proxy type** of each outbound request on an instance's Monitoring
tab — in both the Live Traffic table and the Domain Requests groups — so the
user can see *how* the sandbox proxy handled each host (credential-injecting
forward proxy, bypass, transparent intercept, raw network, or a host-browser
open). A collapsible legend explains what each type means.

Reference: <https://docs.docker.com/ai/sandboxes/governance/monitoring/#monitoring-traffic>

## Background — the data already exists

`sbx policy log --json` returns `{ allowed_hosts, blocked_hosts }`, and **every
row already carries a `proxy_type` field** (verified against a live sandbox).
The app currently parses only `host`, `reason`, `last_seen`, `count_since` and
drops `proxy_type`. This feature threads that field through to the UI. No new
sbx call, no new IPC surface.

### The five proxy types (from the Docker docs)

| `proxy_type` | Friendly label | Meaning | Tone |
|--------------|----------------|---------|------|
| `forward` | Forward | Forward proxy — supports credential injection | ok |
| `forward-bypass` | Forward (bypass) | Forward proxy without credential injection | warn |
| `transparent` | Transparent | Transparent proxy — policy enforced, no credential injection | warn |
| `network` | Network | Non-HTTP traffic (raw TCP/UDP/ICMP); UDP & ICMP are always blocked | neutral |
| `browser-open` | Browser open | A sandbox process asked to open a URL in the host browser | info |

An unknown or empty `proxy_type` renders the raw string (or nothing when empty)
with a neutral tone and a generic tooltip — a future sbx type never breaks the UI.

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Where shown | Live Traffic table (new column) **and** Domain Requests groups (inline). |
| Display treatment | Color-coded **badge** whose text is the friendly label and whose tooltip (`title`) is the plain-language meaning. |
| Legend | A collapsible `<details>` "Proxy types" (collapsed by default) listing all five with one-line meanings + a "Learn more" link to the Docker docs. |
| Color semantics | Tone is separate from the ✓/✕ allowed/blocked color: `ok`=forward, `warn`=forward-bypass/transparent (no credential injection), `neutral`=network, `info`=browser-open. |

## Architecture / components

### 1. Data layer
- **`src/shared/types.ts`** — add `proxyType: string` to `PolicyEvent`.
- **`src/main/sbx/policy-log.ts`** — `toEvents()` reads `o.proxy_type` (typeof
  string, else `''`) into each event. Both allowed and blocked rows.
  `RawRow` gains `proxy_type?: unknown`.

### 2. Shared proxy-type metadata — new `src/shared/proxy-types.ts`
Single source of truth consumed by the badge, its tooltip, and the legend:

```ts
export type ProxyTone = 'ok' | 'warn' | 'neutral' | 'info'
export interface ProxyTypeInfo { key: string; tone: ProxyTone } // labels/meanings via i18n
export const PROXY_TYPES: string[] = ['forward', 'forward-bypass', 'transparent', 'network', 'browser-open']
export function proxyTone(type: string): ProxyTone { /* map; default 'neutral' */ }
```

Labels and meanings live in i18n (keyed by a slug per type), NOT hardcoded here,
so both languages stay in sync. This module owns only the *tone* mapping and the
canonical ordered list for the legend.

### 3. UI — `src/renderer/screens/detail/MonitoringTab.tsx`
- New `ProxyBadge` component: a muted pill, `className` carries the tone, text is
  the i18n friendly label, `title` is the i18n meaning. Empty `proxyType` → render
  nothing (keeps rows clean when the field is absent).
- **Live Traffic table:** add a **Proxy** column header + a `<ProxyBadge>` cell,
  placed between Host and Reason.
- **Domain Requests groups (`DomainGroup`):** the aggregated rows are per-host;
  each host's proxy type is stable, so pass it through and render the badge inline
  between the host and the count. (`DomainGroup`'s `rows` gain `proxyType`.)
- **Legend:** a `<details className="proxy-legend">` after the Domain Requests
  card (or after Live Traffic when there are no events), summary = i18n legend
  title; body lists `PROXY_TYPES` each as `<ProxyBadge> — meaning`, plus a
  "Learn more" anchor to the docs URL (`target="_blank" rel="noreferrer"`).

### 4. Styling — `src/renderer/theme/app.css`
- `.proxy-badge` base pill (small, mono-ish, muted bg, padding, radius).
- Tone modifiers `.proxy-badge.ok / .warn / .neutral / .info` — subtle text/border
  color via existing tokens (`--success`, `--warning`/`--danger`-adjacent,
  `--text-muted`, `--accent`). Theme-aware through tokens.
- `.proxy-legend` spacing.

### 5. i18n — `src/renderer/i18n/en.ts` + `de.ts`
New keys under the `detail` block:
- `colProxy` (column header)
- `proxyLegendTitle`, `proxyLegendLearnMore`
- Per type (slug): `proxyForwardLabel`/`proxyForwardMeaning`,
  `proxyForwardBypassLabel`/`…Meaning`, `proxyTransparentLabel`/`…Meaning`,
  `proxyNetworkLabel`/`…Meaning`, `proxyBrowserOpenLabel`/`…Meaning`.
A small `proxyLabel(t, type)` / `proxyMeaning(t, type)` helper maps a raw type
to its i18n key (unknown → returns the raw string / a generic "Handled by the
proxy" meaning).

## Data flow
`sbx policy log --json` → `parsePolicyLog` (now keeps `proxy_type`) → `PolicySummary.events[].proxyType`
→ `instance:policyLog` IPC (unchanged shape, richer events) → `MonitoringTab`
renders `<ProxyBadge>` per row + legend.

## Error handling
- Missing/empty `proxy_type`: event gets `proxyType: ''`; badge renders nothing.
- Unknown value (future sbx type): badge shows the raw string, neutral tone,
  generic tooltip; legend still lists the five known types.
- Malformed JSON: unchanged — `parsePolicyLog` already returns `EMPTY`.

## Testing
- **`tests/main/sbx/policy-log.test.ts`**: given rows with `proxy_type`, the parsed
  events carry `proxyType`; allowed + blocked both; a row missing the field → `''`.
- **`tests/renderer/detail/MonitoringTab.test.tsx`** (existing): a row with
  `proxyType: 'forward'` renders a badge showing the friendly
  label with the meaning as its `title`; a `forward-bypass` row carries the `warn`
  tone class; the legend renders all five entries and the docs link. An event with
  `proxyType: ''` renders no badge.

## Out of scope (YAGNI)
- Filtering the log by proxy type.
- Surfacing the `rule` field (distinct from the existing `reason`).
- `--type filesystem` logs (sbx does not support them yet).
- Any change to the allowed/blocked counters or the Allow/Deny actions.
