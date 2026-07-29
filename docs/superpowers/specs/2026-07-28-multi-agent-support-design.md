# Multi-agent sandbox support — design

## Problem

The wizard already offers four coding-agent templates (`claude-code`, `opencode`, `codex`,
`copilot`) via `BUILTIN_VARIANTS`, but the app only ever launches sandboxes for Claude Code.
Three places hardcode the assumption that the agent is `claude`:

- `src/main/sbx/translate.ts:8,95,128` — `AGENT_KEYWORD = 'claude'` is passed as the positional
  agent argument to `sbx create`/`sbx run`, regardless of which template was chosen.
- `src/main/sbx/translate.ts:117-119,159-163` — attach/resume and new-session-naming pass
  Claude-specific flags (`--continue`, `--name`) after `sbx run`'s `--` separator.
- `src/main/kit/generate.ts:14-19` — every generated kit's network allowlist always includes
  `CLAUDE_AGENT_DOMAINS`, regardless of which agent the sandbox runs.

Selecting `opencode` in the wizard produces a sandbox that `sbx` refuses to run correctly
(`⚠ template was built for "opencode" but you are using "claude"` → `500 Internal Server Error`),
because the app still tells `sbx` to launch `claude` inside an opencode image.

## Goals

- Generalize agent selection so `claude`, `opencode`, `codex`, and `copilot` all launch correctly,
  and adding a further agent later is a config change, not a rework.
- Fix the reported bug: opencode sandboxes create and run successfully.
- Preserve all current Claude Code behavior exactly (attach, resume, session naming, OAuth login,
  network domains) — this is a pure widening of what already works.

## Non-goals

- **Per-agent OAuth/login flows.** Settings' Claude-specific `/login` flow
  (`src/main/kit/generate.ts:73-82`, `loginCommand` in `translate.ts:127-131`) stays Claude-only.
  Non-Claude agents rely on the existing generic credential mechanisms (service/custom
  credentials) for auth; this design adds no new sign-in UI.
- **Verifying opencode/codex/copilot CLI behavior.** This design records best-effort values for
  each agent's network domains and resume/session-name flags, explicitly flagged as unverified
  except for Claude. Confirming those against each agent's real CLI is follow-up work, gated on
  someone testing an actual launch.

## Design

### A. Agent registry (new: `src/shared/agents.ts`)

A single source of truth for per-agent behavior:

```ts
export type AgentId = 'claude' | 'opencode' | 'codex' | 'copilot'

export interface AgentProfile {
  id: AgentId
  keyword: string                              // `sbx create <keyword> ...` positional
  label: string
  domains: string[]                            // network domains this agent needs (kit allowlist)
  resumeArgs: string[]                          // args after `--` to resume the last session
  sessionNameArgs: (name: string) => string[]   // args after `--` to name a new session
}

export const AGENT_PROFILES: Record<AgentId, AgentProfile>

// Maps each BuiltinVariant (src/renderer/wizard/draft.ts) to the agent it runs.
export const VARIANT_AGENT: Record<BuiltinVariant, AgentId> = {
  'claude-code': 'claude', 'claude-code-docker': 'claude', 'claude-code-minimal': 'claude',
  opencode: 'opencode', codex: 'codex', copilot: 'copilot'
}
```

Claude's profile carries today's verified values: `domains` = current `CLAUDE_AGENT_DOMAINS`,
`resumeArgs = ['--continue']`, `sessionNameArgs = (n) => ['--name', n]`. The opencode/codex/copilot
profiles get placeholder values with an inline `// TODO: verify against <agent> CLI` comment —
none of this is presented as confirmed behavior.

Seed values for the placeholder profiles:

| Agent | `keyword` | `domains` | `resumeArgs` | `sessionNameArgs` |
|---|---|---|---|---|
| opencode | `opencode` | `[]` — see note below | `['--continue']` | `(n) => ['--session', n]` |
| codex | `codex` | `['api.openai.com', 'chatgpt.com']` | `['--continue']` | `(n) => []` (no known equivalent) |
| copilot | `copilot` | `['github.com', '*.githubusercontent.com', 'copilot-proxy.githubusercontent.com']` | `['--continue']` | `(n) => []` (no known equivalent) |

`resumeArgs: ['--continue']` is copied from Claude as the most common convention across CLI
agents; it is an assumption, not a verified fact, for opencode/codex/copilot alike.

**Note on opencode's domains:** unlike Claude/Codex/Copilot, opencode is not tied to one model
vendor — it's configured against whichever provider the user sets up (Anthropic, OpenAI, a local
model, etc.), so there's no single fixed domain list that's correct for every opencode sandbox.
Its profile ships with `domains: []`; users must add their configured provider's domain(s) via
the wizard's existing custom-domains field (`Draft.domains` / `DefinitionSpec.domains`), same
mechanism already used for any other unlisted service.

### B. Data model

- `Definition` (`src/shared/types.ts`) gains a required field: `agent: AgentId`.
- `Draft` (`src/renderer/wizard/draft.ts`) gains `agent: AgentId`; `initialDraft.agent = 'claude'`.

### C. Wizard UI

- `setImageChoice` reducer case: when the new choice is a builtin variant, auto-set
  `agent: VARIANT_AGENT[value]`. When it's `'custom'`, leave `agent` as its current value.
- `CreateDefinition.tsx` step 2 (Base Image): when `imageChoice === 'custom'`, render an "Agent"
  `<select>` populated from `AGENT_PROFILES`, bound to a new `setAgent` action. For builtin
  choices, show the derived agent as read-only text (e.g. "Agent: OpenCode") — no editable
  control, since it's implied by the template.
- `toSpec` writes `d.agent` into `Definition.agent`. `draftFromSpec` reads `spec.definition.agent`
  back, falling back to `VARIANT_AGENT[knownVariant]` when the loaded value is missing/stale
  (belt-and-suspenders with the DB backfill in section E).

### D. Command construction (`src/main/sbx/translate.ts`)

- Remove `AGENT_KEYWORD`. `specToCreateArgs`: `['create', AGENT_PROFILES[spec.definition.agent].keyword, primary.hostPath, ...]`.
- `agentAttachCommand(name, agent: AgentId)` gains an `agent` param:
  `` `sbx run --name ${quoted} -- ${AGENT_PROFILES[agent].resumeArgs.join(' ')}` ``. The caller
  passes the instance's known agent (from its `Definition`, or `SbxInstance.agent` for
  unmanaged instances).
- `launchCommand`: the `sbx run` step's session-name args come from
  `AGENT_PROFILES[spec.definition.agent].sessionNameArgs(sessionName)` instead of the hardcoded
  `['--name', sessionName]`.
- `loginCommand` is **unchanged** — stays hardcoded to `'claude'` (non-goal: per-agent login).

### E. Network domains (`src/main/kit/generate.ts`)

- `allowedDomains(spec)`: replace the unconditional `...CLAUDE_AGENT_DOMAINS` with
  `...AGENT_PROFILES[spec.definition.agent].domains`.
- `CLAUDE_AGENT_DOMAINS` and `OAUTH_LOGIN_DOMAINS` stay as-is, used only by `buildLoginKit()`.

### F. Storage migration (`src/main/store/db.ts`)

Follows the existing `kit_commands_yaml` precedent (v7→v8 step, `db.ts:139-142`):

- New step: `ALTER TABLE definition ADD COLUMN agent TEXT DEFAULT 'claude'`, guarded by the same
  `if (!defCols.includes('agent'))` pattern as the other ad-hoc migration steps; bump
  `PRAGMA user_version`.
- One-time backfill, run immediately after the `ALTER TABLE`, matching `VARIANT_AGENT` by
  `base_image` suffix:
  ```sql
  UPDATE definition SET agent='opencode' WHERE base_image LIKE '%:opencode';
  UPDATE definition SET agent='codex'    WHERE base_image LIKE '%:codex';
  UPDATE definition SET agent='copilot'  WHERE base_image LIKE '%:copilot';
  ```
  Rows for `claude-code`/`-docker`/`-minimal` variants and any custom ref already get the column
  default `'claude'` — which matches what actually ran before this change, since `claude` was the
  only agent that ever launched correctly.
- Thread `agent` through existing read/write sites: SELECT column lists (`listDefinitions`,
  `getDefinition`, `getDefinitionSpec` — `db.ts:192,195,224`) and INSERT/UPDATE statements
  (`insertDefinition`, `insertDefinitionSpec`, `updateDefinitionSpec` — `db.ts:186-189,202-205,213-216`).

## Testing

- `translate.test.ts`: update the existing hardcoded-`'claude'` assertion (`translate.test.ts:3,92`);
  add per-agent cases for `specToCreateArgs`, `agentAttachCommand`, `launchCommand`, driven by
  `AGENT_PROFILES`.
- New `agents.test.ts`: `VARIANT_AGENT` covers every `BuiltinVariant`; every `AgentProfile` has a
  non-empty `keyword` and `domains`.
- Kit generation tests: `allowedDomains` pulls from the right profile per `spec.definition.agent`.
- `db.ts` migration test: seed a pre-migration row with a `:opencode` `base_image`, run the
  migration, assert `agent === 'opencode'`.
- Manual/acceptance: launch an actual `opencode` sandbox end-to-end (the original bug report) —
  this is the real acceptance test for the opencode profile. codex/copilot profiles stay
  unverified until someone tests against those templates; do not claim they work until then.

## Open questions / follow-up

- opencode/codex/copilot `domains`, `resumeArgs`, and `sessionNameArgs` in `AGENT_PROFILES` are
  best-effort placeholders and need verification against each CLI's real behavior before those
  agents are considered fully supported (not just "launches without the create-time error").
