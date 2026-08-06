# Design: Move instance Tags into a new "Metadata" tab

**Date:** 2026-08-06
**Status:** Approved (ready for implementation planning)

## Problem

The instance Tags editor is rendered as an always-visible full-width card between the
Instance Detail header and the tab bar. It consumes significant vertical space and pushes
the Terminals/Ports/Monitoring content down, even when the user isn't editing tags.

## Goal

Relocate the Tags editor into its own detail tab ("Metadata"), reclaiming the header space.
Tags are fully moved — no tag UI remains in the always-visible header area.

## Decisions (resolved during brainstorming)

- **Tab name:** "Metadata" (future-proof; may hold other per-instance metadata later — for now, only Tags).
- **Header:** fully move — remove the Tags card from the header entirely; tags are seen/edited only in the Metadata tab.
- **Tab order:** Terminals · Ports · Monitoring · **Metadata** (Metadata last).

## Non-goals

- No new metadata fields beyond Tags (YAGNI). The tab name only leaves room to grow.
- No change to tag storage, IPC, normalization, or the launch/Instances-screen tag UI.
- No change to how tag edits persist (still `onSetTags` → `api.instanceSetTags` → `loadInstances()`).

## Components

**New — `src/renderer/screens/detail/MetadataTab.tsx`**
- Presentational tab component, following the existing detail-tab pattern (`PortsTab`,
  `MonitoringTab`, `TerminalsTab`): uses `useT()` internally, receives data via props.
- Props: `{ tags: string[]; onChange: (tags: string[]) => void }`.
- Renders a card with the title `t('detail.tagsTitle')`, the `TagInput`
  (`ariaLabel="Edit instance tags"`, placeholder `t('detail.tagsPlaceholder')`), and the
  hint `t('detail.tagsHint')` — i.e. the exact content currently inline in `InstanceDetail`.

**Modified — `src/renderer/screens/detail/InstanceDetail.tsx`**
- Extend `DetailTab` to `'terminals' | 'ports' | 'monitoring' | 'metadata'`.
- Add a fourth tab button after Monitoring, labelled `t('detail.tabMetadata')`.
- **Remove** the always-visible Tags card (the block currently rendered between the
  `detail-header` and the `credsDrift` banner).
- Keep the existing `tags` local state and its resync `useEffect` in `InstanceDetail` (so the
  optimistic value survives tab switches). Render
  `{tab === 'metadata' && <MetadataTab tags={tags} onChange={(next) => { setTags(next); onSetTags(instance.name, next) }} />}`
  in the tab-content area alongside the other `{tab === '…' && <…Tab/>}` blocks.

## i18n

Add one key, `detail.tabMetadata`, to BOTH `src/renderer/i18n/en.ts` and `de.ts`
(en: "Metadata"; de: "Metadaten"). Reuse the existing `detail.tagsTitle`,
`detail.tagsHint`, `detail.tagsPlaceholder`.

## Data flow

Unchanged. `InstanceDetail` owns `tags` state (seeded from `instance.tags`, resynced on
`[instance.name, instance.tags]` with a content-compare bail-out already in place). The
Metadata tab's `onChange` sets that state optimistically and calls `onSetTags`, which flows
to `api.instanceSetTags` and a subsequent `loadInstances()` — identical to today's behavior;
only the editor's location moves.

## Error handling

No new failure modes. Tag-write failures still surface via the existing `onSetTags` handler's
error notice.

## Testing

- **New** `tests/renderer/detail/MetadataTab.test.tsx`: rendering with `tags={['prod']}`,
  typing `eu` + Enter in the "Edit instance tags" field calls `onChange` with
  `['prod', 'eu']`.
- **Update** `tests/renderer/detail/InstanceDetail.tags.test.tsx`: the editor now lives behind
  the Metadata tab, so the test must click the "Metadata" tab (`role="tab"`, name "Metadata")
  before typing, then assert `onSetTags('proj-a1', ['prod', 'eu'])` — preserving the existing
  end-to-end coverage.
- The existing `InstanceDetail.test.tsx` tab tests should be unaffected (they don't assert on
  the removed header card); if any assert tab counts, update minimally.
