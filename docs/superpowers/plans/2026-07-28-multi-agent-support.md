# Multi-agent sandbox support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize sandbox creation/attach/network-allowlist so `claude`, `opencode`, `codex`, and `copilot` all launch correctly, instead of the app always hardcoding `claude`.

**Architecture:** A single new `AgentProfile` registry (`src/shared/agents.ts`) becomes the source of truth for each agent's `sbx create` keyword, resume/session-name CLI args, and network domains. `Definition` gains a required `agent` field that flows: wizard (auto-derived from the built-in template, or explicitly picked for a custom image) → SQLite → `sbx create`/`sbx run`/kit-domain command construction. Non-Claude profiles carry explicitly-flagged best-effort placeholder values.

**Tech Stack:** TypeScript, Electron (main/renderer/shared), better-sqlite3, Vitest, React.

## Global Constraints

- Per the approved spec (`docs/superpowers/specs/2026-07-28-multi-agent-support-design.md`): the Claude OAuth `/login` flow (`loginCommand`, `buildLoginKit`) stays hardcoded to Claude — do not touch it in any task below.
- Every `AgentProfile` entry other than `claude` must carry an inline `// TODO: verify against <agent> CLI` comment — never present placeholder domains/args as confirmed behavior.
- `tsconfig.json` / `vitest.config.ts` alias `@shared/*` → `src/shared/*`, `@main/*` → `src/main/*`. Some existing test files use these aliases, others use relative `../../../src/...` paths — match whichever style the file you're editing already uses; use `@shared/*`/`@main/*` for brand-new files.
- Run `npm run typecheck` and `npm test` after every task; both must be clean before moving on.

---

### Task 1: Agent registry (`src/shared/agents.ts`)

**Files:**
- Create: `src/shared/agents.ts`
- Test: `tests/shared/agents.test.ts`

**Interfaces:**
- Produces: `AgentId` (`'claude' | 'opencode' | 'codex' | 'copilot'`), `BuiltinVariant` (moved here from `src/renderer/wizard/draft.ts`), `AgentProfile` interface, `AGENT_PROFILES: Record<AgentId, AgentProfile>`, `VARIANT_AGENT: Record<BuiltinVariant, AgentId>`, `agentFromBaseImage(baseImage: string): AgentId`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/agents.test.ts
import { describe, it, expect } from 'vitest'
import { AGENT_PROFILES, VARIANT_AGENT, agentFromBaseImage } from '@shared/agents'
import type { AgentId, BuiltinVariant } from '@shared/agents'

const AGENT_IDS: AgentId[] = ['claude', 'opencode', 'codex', 'copilot']
const VARIANTS: BuiltinVariant[] = ['claude-code', 'claude-code-docker', 'claude-code-minimal', 'opencode', 'codex', 'copilot']

describe('AGENT_PROFILES', () => {
  it('has a profile for every agent with a non-empty keyword and resumeArgs', () => {
    for (const id of AGENT_IDS) {
      const p = AGENT_PROFILES[id]
      expect(p.id).toBe(id)
      expect(p.keyword.length).toBeGreaterThan(0)
      expect(p.resumeArgs.length).toBeGreaterThan(0)
      expect(Array.isArray(p.domains)).toBe(true)
    }
  })
  it('carries the verified Claude values', () => {
    expect(AGENT_PROFILES.claude.keyword).toBe('claude')
    expect(AGENT_PROFILES.claude.resumeArgs).toEqual(['--continue'])
    expect(AGENT_PROFILES.claude.sessionNameArgs('Refactor auth')).toEqual(['--name', 'Refactor auth'])
    expect(AGENT_PROFILES.claude.domains).toContain('api.anthropic.com')
  })
  it('opencode ships with no hardcoded domains (multi-provider — user adds their own)', () => {
    expect(AGENT_PROFILES.opencode.domains).toEqual([])
  })
})

describe('VARIANT_AGENT', () => {
  it('maps every BuiltinVariant to an AgentId', () => {
    for (const v of VARIANTS) expect(AGENT_IDS).toContain(VARIANT_AGENT[v])
  })
  it('maps all three claude-code variants to claude', () => {
    expect(VARIANT_AGENT['claude-code']).toBe('claude')
    expect(VARIANT_AGENT['claude-code-docker']).toBe('claude')
    expect(VARIANT_AGENT['claude-code-minimal']).toBe('claude')
  })
})

describe('agentFromBaseImage', () => {
  it('matches a known variant suffix', () => {
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:opencode')).toBe('opencode')
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:codex')).toBe('codex')
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:copilot')).toBe('copilot')
  })
  it('does not let claude-code-docker/-minimal collide with the bare claude-code suffix check', () => {
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:claude-code-docker')).toBe('claude')
    expect(agentFromBaseImage('docker.io/docker/sandbox-templates:claude-code-minimal')).toBe('claude')
  })
  it('defaults to claude for an unrecognized or custom ref', () => {
    expect(agentFromBaseImage('my/custom:tag')).toBe('claude')
    expect(agentFromBaseImage('')).toBe('claude')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/agents.test.ts`
Expected: FAIL — `Cannot find module '@shared/agents'` (or similar), since the file doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/agents.ts
export type AgentId = 'claude' | 'opencode' | 'codex' | 'copilot'

export type BuiltinVariant = 'claude-code' | 'claude-code-docker' | 'claude-code-minimal' | 'opencode' | 'codex' | 'copilot'

export interface AgentProfile {
  id: AgentId
  /** `sbx create <keyword> ...` positional. */
  keyword: string
  label: string
  /** Network domains this agent needs reachable — folded into every generated kit's allowlist. */
  domains: string[]
  /** Args appended after `sbx run`'s `--` separator to resume the last session. */
  resumeArgs: string[]
  /** Args appended after `sbx run`'s `--` separator to name a brand-new session. */
  sessionNameArgs: (name: string) => string[]
}

// Verified via the Phase 0 spike (see src/main/kit/generate.ts CLAUDE_AGENT_DOMAINS/OAUTH_LOGIN_DOMAINS).
const CLAUDE_DOMAINS = [
  'api.anthropic.com', 'console.anthropic.com', 'claude.ai',
  'platform.claude.com', 'claude.com', 'downloads.claude.ai', 'mcp-proxy.anthropic.com'
]

export const AGENT_PROFILES: Record<AgentId, AgentProfile> = {
  claude: {
    id: 'claude',
    keyword: 'claude',
    label: 'Claude Code',
    domains: CLAUDE_DOMAINS,
    resumeArgs: ['--continue'],
    sessionNameArgs: (name) => ['--name', name]
  },
  opencode: {
    id: 'opencode',
    keyword: 'opencode',
    label: 'OpenCode',
    // TODO: verify against the opencode CLI. opencode is multi-provider (Anthropic, OpenAI,
    // local models, …) — there's no single fixed domain list, so this ships empty and users
    // add their configured provider's domain via the wizard's custom-domains field instead.
    domains: [],
    resumeArgs: ['--continue'],
    sessionNameArgs: (name) => ['--session', name]
  },
  codex: {
    id: 'codex',
    keyword: 'codex',
    label: 'OpenAI Codex',
    // TODO: verify against the Codex CLI.
    domains: ['api.openai.com', 'chatgpt.com'],
    resumeArgs: ['--continue'],
    sessionNameArgs: () => []
  },
  copilot: {
    id: 'copilot',
    keyword: 'copilot',
    label: 'GitHub Copilot',
    // TODO: verify against the Copilot CLI.
    domains: ['github.com', '*.githubusercontent.com', 'copilot-proxy.githubusercontent.com'],
    resumeArgs: ['--continue'],
    sessionNameArgs: () => []
  }
}

export const VARIANT_AGENT: Record<BuiltinVariant, AgentId> = {
  'claude-code': 'claude',
  'claude-code-docker': 'claude',
  'claude-code-minimal': 'claude',
  opencode: 'opencode',
  codex: 'codex',
  copilot: 'copilot'
}

/**
 * Best-effort agent for a (possibly custom) base image ref: matches a known built-in
 * variant's image-tag suffix, else 'claude' — the only agent that ever launched correctly
 * before this app supported others, so it's the safe default for anything unrecognized.
 */
export function agentFromBaseImage(baseImage: string): AgentId {
  for (const variant of Object.keys(VARIANT_AGENT) as BuiltinVariant[]) {
    if (baseImage.endsWith(`:${variant}`)) return VARIANT_AGENT[variant]
  }
  return 'claude'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/agents.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/shared/agents.ts tests/shared/agents.test.ts
git commit -m "feat: add per-agent profile registry (claude/opencode/codex/copilot)"
```

---

### Task 2: Add `agent` field to `Definition` + sweep leftover fixtures

Adds the required `agent: AgentId` field to the `Definition` type, and fixes every test fixture NOT already covered by a dedicated task below (Tasks 3–8 each fix their own files as part of their own work). This task's file list was found via `grep -rn "baseImage:" src/ tests/`.

**Files:**
- Modify: `src/shared/types.ts:13-20` (`Definition` interface)
- Modify (test fixtures — add `agent: 'claude'`): `tests/main/auth/manager.test.ts:6`, `tests/main/sbx-lifecycle.test.ts:15`, `tests/main/launch.test.ts:6`, `tests/main/reconciler.test.ts:31,39,57`, `tests/main/detail/persist.test.ts:8`, `tests/renderer/Definitions.test.tsx:7,47,48`, `tests/renderer/detail/TerminalsTab.test.tsx:8`, `tests/renderer/App.launch.test.tsx:20,33`, `tests/renderer/LaunchDialog.test.tsx:6`

**Interfaces:**
- Consumes: `AgentId` from `@shared/agents` (Task 1).
- Produces: `Definition.agent: AgentId` — every later task relies on this field existing.

- [ ] **Step 1: Add the field to the type**

In `src/shared/types.ts`, add the import and field:

```ts
// at the top, alongside existing imports
import type { AgentId } from './agents'
```

```ts
// Definition interface — add `agent` after `baseImage`
export interface Definition {
  id: string
  name: string
  description: string
  baseImage: string
  agent: AgentId
  tier: Tier
  createdAt: string
}
```

- [ ] **Step 2: Run the typechecker to enumerate every break**

Run: `npm run typecheck`
Expected: many errors of the shape `Property 'agent' is missing in type '{ id: ...; baseImage: ...; }' but required in type 'Definition'`, one per file/line listed below (plus files handled by Tasks 3–8, which you are NOT fixing in this task).

- [ ] **Step 3: Fix each fixture in this task's file list**

For every literal below, insert `agent: 'claude', ` immediately before `baseImage:`. Two examples of the exact transformation:

```ts
// tests/main/auth/manager.test.ts:6 — before:
definition: { id: 'd', name: 'n', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
// after:
definition: { id: 'd', name: 'n', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
```

```ts
// tests/main/reconciler.test.ts:31 — before:
store.insertDefinition({ id: 'd1', name: 'prj-alpha', description: '', baseImage: 'img', tier: 'locked', createdAt: 't' })
// after:
store.insertDefinition({ id: 'd1', name: 'prj-alpha', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' })
```

Apply the same `agent: 'claude', ` insertion (right before `baseImage:`) to the remaining locations:

- `tests/main/sbx-lifecycle.test.ts:15`
- `tests/main/launch.test.ts:6`
- `tests/main/reconciler.test.ts:39` and `:57` (both `const base = { id: ..., baseImage: 'img', tier: 'locked' as const, createdAt: 't' }`)
- `tests/main/detail/persist.test.ts:8`
- `tests/renderer/Definitions.test.tsx:7`, `:47`, `:48`
- `tests/renderer/detail/TerminalsTab.test.tsx:8`
- `tests/renderer/App.launch.test.tsx:20` (nested inside `defGetSpec`'s returned object) and `:33` (`oneDef`'s array literal)
- `tests/renderer/LaunchDialog.test.tsx:6` (`const def: Definition = {...}`)

- [ ] **Step 4: Run the typechecker again, then the full test suite**

Run: `npm run typecheck && npm test`
Expected: `typecheck` clean of errors from the files in this task's list (errors remaining in Tasks 3–8's files are expected and fixed in those tasks — do not fix them here). Tests in this task's files pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/main/auth/manager.test.ts tests/main/sbx-lifecycle.test.ts tests/main/launch.test.ts tests/main/reconciler.test.ts tests/main/detail/persist.test.ts tests/renderer/Definitions.test.tsx tests/renderer/detail/TerminalsTab.test.tsx tests/renderer/App.launch.test.tsx tests/renderer/LaunchDialog.test.tsx
git commit -m "feat: add required agent field to Definition"
```

---

### Task 3: `src/main/sbx/translate.ts` — agent-aware command construction

**Files:**
- Modify: `src/main/sbx/translate.ts:8,95,117-119,159-163`
- Modify (tests): `tests/main/sbx/translate.test.ts`, `tests/main/sbx/translate-copyfiles.test.ts:52-53,74`, `tests/main/sbx/translate-kit.test.ts:5-6`, `tests/main/sbx/translate-ssh.test.ts:5-6`

**Interfaces:**
- Consumes: `AGENT_PROFILES`, `AgentId` from `@shared/agents` (Task 1); `Definition.agent` (Task 2).
- Produces: `specToCreateArgs(spec)` (unchanged signature, now agent-aware), `agentAttachCommand(name: string, agent: AgentId)` (signature change — now takes `agent`), `launchCommand(spec, ...)` (unchanged signature, session-name args now agent-aware). `AGENT_KEYWORD` export is REMOVED — Task 7 (`ipc.ts`) and Task 2's sweep do not reference it, but double-check no other file imports it before removing.

- [ ] **Step 1: Write the failing tests**

In `tests/main/sbx/translate.test.ts`, replace the `AGENT_KEYWORD` import and its two usages, and add per-agent coverage:

```ts
// replace the import block (remove AGENT_KEYWORD, keep everything else the same)
import {
  toSbxName,
  resolveSandboxName,
  uniqueSandboxName,
  hashedSandboxName,
  tierToAllowlist,
  specToCreateArgs,
  portIntentToPublishSpec,
  shellQuote,
  shellCommand,
  launchCommand,
  agentAttachCommand,
  hostShellCommand,
  sshHostKeySetupCommand
} from '../../../src/main/sbx/translate'
import { AGENT_PROFILES } from '../../../src/shared/agents'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(over: Partial<DefinitionSpec> = {}): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
    mounts: [{ hostPath: '/home/u/proj', mode: 'direct', isPrimary: true }],
    domains: [],
    ports: [],
    hostServices: [],
    credentials: [],
    ...over
  }
}
```

Update `specToCreateArgs`'s existing test (was `AGENT_KEYWORD`, now `AGENT_PROFILES.claude.keyword`) and add an opencode case:

```ts
describe('specToCreateArgs', () => {
  it('builds create argv with agent keyword, name and template', () => {
    expect(specToCreateArgs(spec())).toEqual([
      'create', AGENT_PROFILES.claude.keyword, '/home/u/proj',
      '--name', 'my-project',
      '--template', 'docker.io/docker/sandbox-templates:claude-code'
    ])
  })
  it('uses the opencode keyword for an opencode-agent definition', () => {
    const args = specToCreateArgs(spec({ definition: { ...spec().definition, agent: 'opencode', baseImage: 'docker.io/docker/sandbox-templates:opencode' } }))
    expect(args).toEqual([
      'create', 'opencode', '/home/u/proj',
      '--name', 'my-project',
      '--template', 'docker.io/docker/sandbox-templates:opencode'
    ])
  })
  // ...keep the other existing "specToCreateArgs" cases (--clone, extra mounts, empty
  // baseImage, name override) unchanged
})
```

Update the `agentAttachCommand` assertion and add an opencode case:

```ts
describe('shell command builders', () => {
  it('quotes names and builds run/exec commands', () => {
    expect(shellQuote('a b')).toBe("'a b'")
    expect(agentAttachCommand('my-project', 'claude')).toBe("sbx run --name 'my-project' -- --continue")
    expect(hostShellCommand('my-project')).toBe("sbx exec -it 'my-project' bash")
  })
  it('agentAttachCommand uses the given agent\\'s resumeArgs', () => {
    expect(agentAttachCommand('my-project', 'opencode')).toBe("sbx run --name 'my-project' -- --continue")
  })
  it('shellCommand leaves safe args unquoted and quotes the rest', () => {
    expect(shellCommand(['sbx', 'run', '--name', 'my-project'])).toBe('sbx run --name my-project')
    expect(shellCommand(['sbx', 'x', 'a b'])).toBe("sbx x 'a b'")
    expect(shellCommand(['sbx', 'x', '**'])).toBe("sbx x '**'")
  })
})
```

Update the `launchCommand` session-name test to also cover a non-Claude agent:

```ts
  it('appends the session name as claude --name after the -- separator', () => {
    const cmd = launchCommand(spec(), 'my-project', 'Refactor auth')
    expect(cmd).toMatch(/&& sbx run --name my-project -- --name 'Refactor auth'$/)
  })
  it('appends the session name using the opencode --session flag for an opencode definition', () => {
    const s = spec({ definition: { ...spec().definition, agent: 'opencode', baseImage: 'docker.io/docker/sandbox-templates:opencode' } })
    const cmd = launchCommand(s, 'my-project', 'Refactor auth')
    expect(cmd).toMatch(/&& sbx run --name my-project -- --session 'Refactor auth'$/)
  })
```

Update the three sibling test files' fixtures and the one direct `agentAttachCommand` call:

```ts
// tests/main/sbx/translate-copyfiles.test.ts:52-53 — add agent: 'claude'
const spec = (copyFiles: { hostPath: string; sandboxPath: string }[]): DefinitionSpec => ({
  definition: { id: 'd1', name: 'proj', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/w', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: [],
  ssh: { forwardAgent: false, commitSigning: false },
  copyFiles
})
```

```ts
// tests/main/sbx/translate-copyfiles.test.ts:74 — before/after
expect(agentAttachCommand('sbx-x')).not.toContain('sbx cp')
// after:
expect(agentAttachCommand('sbx-x', 'claude')).not.toContain('sbx cp')
```

```ts
// tests/main/sbx/translate-kit.test.ts:5-6 — add agent: 'claude'
const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'proj', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
}
```

```ts
// tests/main/sbx/translate-ssh.test.ts:5-6 — add agent: 'claude'
const base: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: []
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/sbx/`
Expected: FAIL — `agentAttachCommand` called with 2 args against a 1-arg signature (type error) and/or the new opencode-keyword/session-args assertions failing against the old hardcoded `'claude'`/`--name` behavior.

- [ ] **Step 3: Implement**

In `src/main/sbx/translate.ts`:

```ts
// remove this line entirely:
// export const AGENT_KEYWORD = 'claude'

// add this import near the top, alongside the existing @shared/types import
import { AGENT_PROFILES } from '@shared/agents'
import type { AgentId } from '@shared/agents'
```

```ts
// specToCreateArgs — change the args line
export function specToCreateArgs(spec: DefinitionSpec, name: string = resolveSandboxName(spec), kitDir?: string): string[] {
  const primary = spec.mounts.find((m) => m.isPrimary) ?? spec.mounts[0]
  const extras = spec.mounts.filter((m) => m !== primary)
  const args = ['create', AGENT_PROFILES[spec.definition.agent].keyword, primary.hostPath]
  for (const m of extras) args.push(m.mode === 'clone' ? `${m.hostPath}:ro` : m.hostPath)
  args.push('--name', name)
  if (spec.definition.baseImage.trim().length > 0) args.push('--template', spec.definition.baseImage)
  if (kitDir) args.push('--kit', kitDir)
  return args
}
```

```ts
// agentAttachCommand — gains an agent param
export function agentAttachCommand(name: string, agent: AgentId): string {
  return `sbx run --name ${shellQuote(name)} -- ${AGENT_PROFILES[agent].resumeArgs.join(' ')}`
}
```

```ts
// launchCommand — session-name args come from the profile
export function launchCommand(spec: DefinitionSpec, name: string = resolveSandboxName(spec), sessionName?: string, kitDir?: string): string {
  const steps: string[] = [shellCommand(['sbx', ...specToCreateArgs(spec, name, kitDir)])]
  if (!kitDir) {
    const resources = tierToAllowlist(spec.definition.tier, spec.domains)
    if (resources.length > 0) {
      steps.push(shellCommand(['sbx', 'policy', 'allow', 'network', '--sandbox', name, resources.join(',')]))
    }
  }
  for (const p of spec.ports) {
    steps.push(shellCommand(['sbx', 'ports', name, '--publish', portIntentToPublishSpec(p)]))
  }
  const runArgs = ['sbx', 'run', '--name', name]
  if (sessionName && sessionName.trim()) {
    runArgs.push('--', ...AGENT_PROFILES[spec.definition.agent].sessionNameArgs(sessionName.trim()))
  }
  steps.push(shellCommand(runArgs))

  const ssh = spec.ssh ?? DEFAULT_SSH
  const postCreate: string[] = []
  if (ssh.forwardAgent) {
    postCreate.push(sshHostKeySetupCommand(name))
    if (ssh.commitSigning) postCreate.push(commitSigningExecCommand(name))
  }
  for (const entry of spec.copyFiles ?? []) postCreate.push(copyFileStep(name, entry))
  if (postCreate.length) steps.splice(1, 0, ...postCreate)
  const chain = steps.join(' && ')
  return ssh.forwardAgent ? chain : `unset SSH_AUTH_SOCK ; ${chain}`
}
```

Leave `loginCommand` exactly as-is (still hardcoded to `'claude'` — see Global Constraints).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npx vitest run tests/main/sbx/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/sbx/translate.ts tests/main/sbx/translate.test.ts tests/main/sbx/translate-copyfiles.test.ts tests/main/sbx/translate-kit.test.ts tests/main/sbx/translate-ssh.test.ts
git commit -m "feat: make sbx create/run command construction agent-aware"
```

---

### Task 4: `src/main/kit/generate.ts` — per-agent network domains

**Files:**
- Modify: `src/main/kit/generate.ts:14-19,36-52`
- Modify (tests): `tests/main/kit/generate.test.ts`, `tests/main/kit/write.test.ts:19`

**Interfaces:**
- Consumes: `AGENT_PROFILES` from `@shared/agents` (Task 1); `Definition.agent` (Task 2).
- Produces: `allowedDomains`/`buildKitSpec` behavior unchanged in signature, now agent-aware. `CLAUDE_AGENT_DOMAINS` stays exported (still used by nothing else after this change except as the source for `AGENT_PROFILES.claude.domains` in Task 1 — leave it defined here too since `buildLoginKit`'s `OAUTH_LOGIN_DOMAINS` is a distinct, smaller list and both must keep working unchanged).

- [ ] **Step 1: Write the failing test**

In `tests/main/kit/generate.test.ts`, update the `spec()` helper to take an agent and add opencode coverage:

```ts
import { describe, it, expect } from 'vitest'
import { buildKitSpec, buildLoginKit } from '../../../src/main/kit/generate'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(creds: DefinitionSpec['credentials'], tier: DefinitionSpec['definition']['tier'] = 'locked', domains: string[] = [], kitCommandsYaml?: string, agent: DefinitionSpec['definition']['agent'] = 'claude'): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'Proj Alpha', description: '', agent, baseImage: 'img:tag', tier, createdAt: '2026-07-19T00:00:00.000Z' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains, ports: [], hostServices: [], credentials: creds,
    ...(kitCommandsYaml !== undefined ? { kitCommandsYaml } : {})
  }
}
```

Update the Claude-baseline test's name/intent slightly (it's still correct, just now explicit about which agent it's testing) and add a new opencode case:

```ts
  it('always allowlists the Claude agent baseline for a claude-agent definition (locked tier)', () => {
    const k = buildKitSpec(spec([], 'locked', [], undefined, 'claude'))
    for (const d of ['api.anthropic.com', 'platform.claude.com', 'console.anthropic.com', 'claude.com', 'downloads.claude.ai', 'claude.ai', 'mcp-proxy.anthropic.com']) {
      expect(k.specYaml).toContain(d)
    }
  })
  it('does not allowlist the Claude domains for an opencode-agent definition', () => {
    const k = buildKitSpec(spec([], 'locked', [], undefined, 'opencode'))
    expect(k.specYaml).not.toContain('api.anthropic.com')
  })
  it('allowlists the Codex domains for a codex-agent definition', () => {
    const k = buildKitSpec(spec([], 'locked', [], undefined, 'codex'))
    expect(k.specYaml).toContain('api.openai.com')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/kit/generate.test.ts`
Expected: FAIL — the new opencode/codex cases fail because `allowedDomains` still unconditionally splices in `CLAUDE_AGENT_DOMAINS` regardless of `spec.definition.agent`.

- [ ] **Step 3: Implement**

In `src/main/kit/generate.ts`:

```ts
import { AGENT_PROFILES } from '@shared/agents'
```

```ts
function allowedDomains(spec: DefinitionSpec): string[] {
  const svc = spec.credentials.flatMap((c) => {
    if (c.kind === 'service') return serviceDomains(c.serviceId)
    if (c.kind === 'registry') return c.scope === 'host' ? [] : [c.host]
    return c.domains
  })
  const hostSvc = spec.hostServices.map((hs) => `localhost:${hs.hostPort}`)
  const tierBase = spec.definition.tier === 'balanced' ? BALANCED_BASELINE : []
  const open = spec.definition.tier === 'open'
  const agentDomains = AGENT_PROFILES[spec.definition.agent].domains
  const all = open ? ['**'] : [...tierBase, ...agentDomains, ...spec.domains, ...svc, ...hostSvc]
  return [...new Set(all.filter((d) => d.trim().length > 0))]
}
```

Leave `CLAUDE_AGENT_DOMAINS`, `OAUTH_LOGIN_DOMAINS`, and `buildLoginKit` untouched — `CLAUDE_AGENT_DOMAINS` becomes dead code inside this file now that `AGENT_PROFILES.claude.domains` (Task 1) is the one actually used by `allowedDomains`; leave the constant in place (harmless, and removing it isn't part of this task's scope).

Update `tests/main/kit/write.test.ts:19`'s fixture to add `agent: 'claude'` (mechanical, same pattern as Task 2):

```ts
// before:
definition: { id: 'deadbeefcafe', name: 'Proj', description: '', baseImage: 'i:t', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
// after:
definition: { id: 'deadbeefcafe', name: 'Proj', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npx vitest run tests/main/kit/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/kit/generate.ts tests/main/kit/generate.test.ts tests/main/kit/write.test.ts
git commit -m "feat: derive kit network allowlist from the definition's agent"
```

---

### Task 5: `src/main/store/db.ts` — persist `agent`, migrate existing rows

**Files:**
- Modify: `src/main/store/db.ts:24-35,105,128-142,185-249`
- Modify (tests): `tests/main/store/db.test.ts:9,16,33`, `tests/main/store/definition-spec.test.ts:9,50`, `tests/main/store/db-ports.test.ts:7`, `tests/main/store/db-ssh.test.ts:7`, `tests/main/store/db-creds.test.ts:7`, `tests/main/store/db-copyfiles.test.ts:9`
- Create: `tests/main/store/db-agent-migration.test.ts`

**Interfaces:**
- Consumes: `Definition.agent` (Task 2) — `db.ts` needs no new import from `@shared/agents`; the migration's backfill matches known variant suffixes directly in SQL (`LIKE '%:opencode'` etc.), not by calling `VARIANT_AGENT` from TypeScript.
- Produces: `Store.insertDefinition`/`listDefinitions`/`getDefinition`/`insertDefinitionSpec`/`updateDefinitionSpec`/`getDefinitionSpec` all read/write `agent` — no signature change (they already take/return `Definition`/`DefinitionSpec`).

- [ ] **Step 1: Write the failing tests**

Add `agent: 'claude'` to every fixture in this task's file list, same mechanical pattern as Task 2:

```ts
// tests/main/store/db.test.ts:9 — before/after
store.insertDefinition({ id: 'def1', name: 'prj-alpha', description: 'alpha', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
store.insertDefinition({ id: 'def1', name: 'prj-alpha', description: 'alpha', agent: 'claude', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
```
```ts
// tests/main/store/db.test.ts:16
store.insertDefinition({ id: 'def1', name: 'prj-alpha', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
```
```ts
// tests/main/store/db.test.ts:33
definition: { id: 'k1', name: 'k', description: '', agent: 'claude', baseImage: 'img', tier: 'locked' as const, createdAt: 't' },
```
```ts
// tests/main/store/definition-spec.test.ts:9
definition: { id: 'd1', name: 'prj-alpha', description: 'Alpha service', agent: 'claude', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' },
```
```ts
// tests/main/store/definition-spec.test.ts:50
definition: { id: 'd2', name: 'bare', description: '', agent: 'claude', baseImage: 'docker/sandbox-templates:claude-code', tier: 'open', createdAt: '2026-07-18T00:00:00Z' },
```
```ts
// tests/main/store/db-ports.test.ts:7
definition: { id, name: 'P', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
```
```ts
// tests/main/store/db-ssh.test.ts:7
definition: { id, name: 'Proj', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: 't' },
```
```ts
// tests/main/store/db-creds.test.ts:7
definition: { id, name: 'Proj', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
```
```ts
// tests/main/store/db-copyfiles.test.ts:9
definition: { id: 'd1', name: 'proj', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' },
```

Create `tests/main/store/db-agent-migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openStore } from '@main/store/db'

describe('agent column migration', () => {
  it('backfills agent from the base_image suffix for pre-migration rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbx-db-'))
    const file = join(dir, 'test.db')
    const raw = new Database(file)
    raw.exec(`
      CREATE TABLE definition (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        base_image TEXT NOT NULL,
        tier TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ssh_forward_agent INTEGER NOT NULL DEFAULT 1,
        ssh_commit_signing INTEGER NOT NULL DEFAULT 0,
        kit_commands_yaml TEXT
      );
    `)
    const ins = raw.prepare(`INSERT INTO definition (id, name, description, base_image, tier, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    ins.run('d1', 'Proj', '', 'docker.io/docker/sandbox-templates:opencode', 'locked', 't')
    ins.run('d2', 'Other', '', 'docker.io/docker/sandbox-templates:claude-code', 'locked', 't')
    ins.run('d3', 'Custom', '', 'my/custom:tag', 'locked', 't')
    raw.close()

    const store = openStore(file)
    expect(store.getDefinition('d1')?.agent).toBe('opencode')
    expect(store.getDefinition('d2')?.agent).toBe('claude')
    expect(store.getDefinition('d3')?.agent).toBe('claude')
    store.close()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck && npx vitest run tests/main/store/`
Expected: FAIL — type errors on the fixtures missing `agent`, and the new migration test failing because the `definition` table has no `agent` column yet.

- [ ] **Step 3: Implement**

In `src/main/store/db.ts`:

```ts
// SCHEMA — add the column and bump the version
CREATE TABLE IF NOT EXISTS definition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_image TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'claude',
  tier TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ssh_forward_agent INTEGER NOT NULL DEFAULT 1,
  ssh_commit_signing INTEGER NOT NULL DEFAULT 0,
  kit_commands_yaml TEXT
);
-- ...(other CREATE TABLE statements unchanged)...
PRAGMA user_version = 10;
```

Add the migration step right after the existing v7→v8 (`kit_commands_yaml`) block:

```ts
  // v8 → v9: definitions gain an agent keyword (multi-agent support). Non-destructive;
  // backfill from base_image's known variant suffix so pre-existing rows keep the agent
  // they were actually built for (unrecognized/custom images default to 'claude', which
  // is what every definition ran as before this column existed).
  if (!defCols.includes('agent')) {
    db.exec(`ALTER TABLE definition ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude';`)
    db.exec(`UPDATE definition SET agent = 'opencode' WHERE base_image LIKE '%:opencode';`)
    db.exec(`UPDATE definition SET agent = 'codex' WHERE base_image LIKE '%:codex';`)
    db.exec(`UPDATE definition SET agent = 'copilot' WHERE base_image LIKE '%:copilot';`)
  }
```

Thread `agent` through every read/write site:

```ts
insertDefinition(d) {
  db.prepare(
    `INSERT INTO definition (id, name, description, base_image, agent, tier, created_at)
     VALUES (@id, @name, @description, @baseImage, @agent, @tier, @createdAt)`
  ).run(d)
},
listDefinitions() {
  return db.prepare(`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt FROM definition ORDER BY created_at DESC`).all() as Definition[]
},
getDefinition(id) {
  const row = db.prepare(`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt FROM definition WHERE id = ?`).get(id)
  return (row as Definition) ?? null
},
insertDefinitionSpec(spec) {
  const insertAll = db.transaction((s: DefinitionSpec) => {
    const ssh = s.ssh ?? DEFAULT_SSH
    db.prepare(
      `INSERT INTO definition (id, name, description, base_image, agent, tier, created_at, ssh_forward_agent, ssh_commit_signing, kit_commands_yaml)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(s.definition.id, s.definition.name, s.definition.description, s.definition.baseImage, s.definition.agent, s.definition.tier, s.definition.createdAt,
      ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null)
    insertChildren(s)
  })
  insertAll(spec)
},
updateDefinitionSpec(spec) {
  const updateAll = db.transaction((s: DefinitionSpec) => {
    const ssh = s.ssh ?? DEFAULT_SSH
    const res = db.prepare(
      `UPDATE definition SET name = ?, description = ?, base_image = ?, agent = ?, tier = ?, ssh_forward_agent = ?, ssh_commit_signing = ?, kit_commands_yaml = ? WHERE id = ?`
    ).run(s.definition.name, s.definition.description, s.definition.baseImage, s.definition.agent, s.definition.tier,
      ssh.forwardAgent ? 1 : 0, (ssh.forwardAgent && ssh.commitSigning) ? 1 : 0, s.kitCommandsYaml ?? null, s.definition.id)
    if (res.changes === 0) throw new Error(`Definition ${s.definition.id} not found`)
    deleteChildren(s.definition.id)
    insertChildren(s)
  })
  updateAll(spec)
},
getDefinitionSpec(id) {
  const def = db.prepare(`SELECT id, name, description, base_image AS baseImage, agent, tier, created_at AS createdAt FROM definition WHERE id = ?`).get(id) as Definition | undefined
  // ...(rest of the function body is unchanged)...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npx vitest run tests/main/store/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/store/db.ts tests/main/store/db.test.ts tests/main/store/definition-spec.test.ts tests/main/store/db-ports.test.ts tests/main/store/db-ssh.test.ts tests/main/store/db-creds.test.ts tests/main/store/db-copyfiles.test.ts tests/main/store/db-agent-migration.test.ts
git commit -m "feat: persist and migrate the definition agent column"
```

---

### Task 6: Wizard UI — agent field in the draft + Create Definition screen

**Files:**
- Modify: `src/renderer/wizard/draft.ts:33,42-50,52-69,71-88,90-142,144-146,169-225`
- Modify: `src/renderer/wizard/CreateDefinition.tsx:292-307`
- Modify: `src/renderer/i18n/en.ts` (wizard section), `src/renderer/i18n/de.ts` (wizard section)
- Modify (tests): `tests/renderer/wizard/draft.test.ts`, `tests/renderer/wizard/CreateDefinition.test.tsx:48,126`

**Interfaces:**
- Consumes: `AgentId`, `BuiltinVariant`, `AGENT_PROFILES`, `VARIANT_AGENT`, `agentFromBaseImage` from `@shared/agents` (Task 1); `Definition.agent` (Task 2).
- Produces: `Draft.agent: AgentId`, `DraftAction` gains `{ type: 'setAgent'; value: AgentId }`, `toSpec`/`draftFromSpec` thread `agent`.

- [ ] **Step 1: Write the failing tests**

In `tests/renderer/wizard/draft.test.ts`, add `agent: 'claude'` to `storedSpec.definition` (line 6) and to the `toSpec` test's expected object (line 149), and add new coverage:

```ts
// storedSpec — before/after
definition: { id: 'd1', name: 'Proj', description: 'desc', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'balanced', createdAt: 't' },
definition: { id: 'd1', name: 'Proj', description: 'desc', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'balanced', createdAt: 't' },
```

```ts
// toSpec test's expectation — before/after
expect(spec.definition).toEqual({ id: 'id1', name: 'alpha', description: 'a', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
expect(spec.definition).toEqual({ id: 'id1', name: 'alpha', description: 'a', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' })
```

Add a new `describe` block covering agent derivation:

```ts
describe('agent selection', () => {
  it('setImageChoice auto-derives the agent for a builtin variant', () => {
    let d = draftReducer(initialDraft, { type: 'setImageChoice', value: 'opencode' })
    expect(d.agent).toBe('opencode')
    d = draftReducer(d, { type: 'setImageChoice', value: 'claude-code-docker' })
    expect(d.agent).toBe('claude')
  })
  it('setImageChoice leaves the agent untouched when switching to custom', () => {
    let d = draftReducer(initialDraft, { type: 'setImageChoice', value: 'opencode' })
    d = draftReducer(d, { type: 'setImageChoice', value: 'custom' })
    expect(d.agent).toBe('opencode')
  })
  it('setAgent overrides the agent directly', () => {
    const d = draftReducer(initialDraft, { type: 'setAgent', value: 'codex' })
    expect(d.agent).toBe('codex')
  })
  it('draftFromSpec reads the stored agent back', () => {
    const d = draftFromSpec({ ...storedSpec, definition: { ...storedSpec.definition, agent: 'opencode' } })
    expect(d.agent).toBe('opencode')
  })
  it('draftFromSpec falls back to deriving from baseImage when agent is missing (pre-migration data)', () => {
    const spec = { ...storedSpec, definition: { ...storedSpec.definition, agent: undefined as never, baseImage: 'docker.io/docker/sandbox-templates:opencode' } }
    expect(draftFromSpec(spec).agent).toBe('opencode')
  })
})
```

In `tests/renderer/wizard/CreateDefinition.test.tsx`, add `agent: 'claude'` to the two fixtures:

```ts
// line 48 — before/after
const editSpec = { definition: { id: 'd1', name: 'full-stack-project-template', description: '', baseImage: 'img:tag', tier: 'locked' as const, createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct' as const, isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }
const editSpec = { definition: { id: 'd1', name: 'full-stack-project-template', description: '', agent: 'claude' as const, baseImage: 'img:tag', tier: 'locked' as const, createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct' as const, isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }
```

```ts
// line 126 — before/after
expect(arg.definition).toMatchObject({ id: 'id1', name: 'prj-alpha', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked' })
expect(arg.definition).toMatchObject({ id: 'id1', name: 'prj-alpha', agent: 'claude', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked' })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck && npx vitest run tests/renderer/wizard/`
Expected: FAIL — `agent`/`setAgent` don't exist yet on `Draft`/`DraftAction`.

- [ ] **Step 3: Implement `draft.ts`**

```ts
// imports — add these two lines
import type { AgentId, BuiltinVariant } from '@shared/agents'
import { VARIANT_AGENT, agentFromBaseImage } from '@shared/agents'
export type { BuiltinVariant } from '@shared/agents'
```

Remove the now-duplicate local type: delete `export type BuiltinVariant = 'claude-code' | ... | 'copilot'` (line 33) — it's re-exported from `@shared/agents` above instead. `VariantInfo`/`BUILTIN_VARIANTS` (labels for the UI) stay in `draft.ts` unchanged.

```ts
// Draft interface — add agent
export interface Draft {
  step: number
  name: string
  description: string
  imageChoice: BuiltinVariant | 'custom'
  agent: AgentId
  customImageRef: string
  // ...(rest unchanged)...
}
```

```ts
// initialDraft — add agent
export const initialDraft: Draft = {
  step: 1,
  name: '',
  description: '',
  imageChoice: 'claude-code',
  agent: 'claude',
  customImageRef: '',
  // ...(rest unchanged)...
}
```

```ts
// DraftAction — add a new variant
export type DraftAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goToStep'; step: number }
  | { type: 'setField'; field: 'name' | 'description' | 'customImageRef' | 'workspace' | 'kitCommandsYaml'; value: string }
  | { type: 'setImageChoice'; value: BuiltinVariant | 'custom' }
  | { type: 'setAgent'; value: AgentId }
  // ...(rest unchanged)...
```

```ts
// draftReducer — update setImageChoice, add setAgent
case 'setImageChoice': return { ...d, imageChoice: a.value, agent: a.value === 'custom' ? d.agent : VARIANT_AGENT[a.value] }
case 'setAgent': return { ...d, agent: a.value }
```

```ts
// draftFromSpec — read agent back, falling back for pre-migration data
export function draftFromSpec(spec: DefinitionSpec): Draft {
  const primary = spec.mounts.find((m) => m.isPrimary) ?? spec.mounts[0]
  const extras = spec.mounts.filter((m) => m !== primary)
  const knownVariant = BUILTIN_VARIANTS.find((v) => `${TEMPLATE_REPO}:${v.value}` === spec.definition.baseImage)
  return {
    step: 1,
    name: spec.definition.name,
    description: spec.definition.description,
    imageChoice: knownVariant ? knownVariant.value : 'custom',
    agent: spec.definition.agent ?? agentFromBaseImage(spec.definition.baseImage),
    customImageRef: knownVariant ? '' : spec.definition.baseImage,
    // ...(rest unchanged)...
  }
}
```

```ts
// toSpec — write agent into the definition
export function toSpec(d: Draft, id: string, createdAt: string): DefinitionSpec {
  return {
    definition: { id, name: effectiveName(d), description: d.description.trim(), agent: d.agent, baseImage: resolveBaseImage(d), tier: d.tier, createdAt },
    // ...(rest unchanged)...
  }
}
```

- [ ] **Step 4: Add the Agent field to `CreateDefinition.tsx`**

```tsx
// i18n keys — add to both src/renderer/i18n/en.ts and src/renderer/i18n/de.ts, inside the `wizard:` object
// en.ts:
agentLabel: 'Agent',
// de.ts:
agentLabel: 'Agent',
```

```tsx
// src/renderer/wizard/CreateDefinition.tsx — inside the draft.step === 2 block, replace the
// "resolvesTo" <p> line with an agent readout/selector immediately after it. First add the
// import: AGENT_PROFILES from '@shared/agents' alongside the existing draft.ts import.
import { AGENT_PROFILES } from '@shared/agents'
```

```tsx
{draft.step === 2 && (
  <>
    <label htmlFor="base-image-select">{t('wizard.builtinTemplates')}</label>
    <select id="base-image-select" className="input" style={{ fontFamily: 'var(--font-mono)' }} value={draft.imageChoice} onChange={(e) => dispatch({ type: 'setImageChoice', value: e.target.value as BuiltinVariant | 'custom' })}>
      {BUILTIN_VARIANTS.map((v) => (<option key={v.value} value={v.value}>{v.value} — {v.label}</option>))}
      <option value="custom">{t('wizard.customOption')}</option>
    </select>
    {draft.imageChoice === 'custom' && (
      <>
        <label htmlFor="custom-image-url" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.imageRefLabel')}</label>
        <input id="custom-image-url" aria-label="Custom image ref" className="input input-mono" placeholder={t('wizard.imageRefPlaceholder')} value={draft.customImageRef} onChange={(e) => dispatch({ type: 'setField', field: 'customImageRef', value: e.target.value })} />
        <label htmlFor="agent-select" style={{ marginTop: 'var(--space-3)' }}>{t('wizard.agentLabel')}</label>
        <select id="agent-select" className="input" style={{ fontFamily: 'var(--font-mono)' }} value={draft.agent} onChange={(e) => dispatch({ type: 'setAgent', value: e.target.value as AgentId })}>
          {Object.values(AGENT_PROFILES).map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
        </select>
      </>
    )}
    {draft.imageChoice !== 'custom' && (
      <p className="section-desc" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>{t('wizard.agentLabel')}: {AGENT_PROFILES[draft.agent].label}</p>
    )}
    <p className="section-desc" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>{t('wizard.resolvesTo')} <span className="code-inline">{resolveBaseImage(draft) || '—'}</span></p>
  </>
)}
```

Add the `AgentId` type import alongside the existing `type BuiltinVariant` import at the top of `CreateDefinition.tsx`:

```ts
import { draftReducer, initialDraft, draftFromSpec, canAdvance, toSpec, resolveBaseImage, effectiveName, basename, TOTAL_STEPS, BUILTIN_VARIANTS, type BuiltinVariant, type DraftCred } from './draft'
import type { AgentId } from '@shared/agents'
import { AGENT_PROFILES } from '@shared/agents'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run typecheck && npx vitest run tests/renderer/wizard/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/wizard/draft.ts src/renderer/wizard/CreateDefinition.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/wizard/draft.test.ts tests/renderer/wizard/CreateDefinition.test.tsx
git commit -m "feat: expose agent selection in the sandbox creation wizard"
```

---

### Task 7: `src/main/ipc.ts` — resolve the right agent for attach/manual commands

**Files:**
- Modify: `src/main/ipc.ts:166-184,202`
- Modify (tests): `tests/main/ipc.test.ts:70,96,108,115,117,128`, `tests/main/ipc-lifecycle.test.ts:6`, `tests/main/ipc-ports.test.ts:8`, `tests/main/ipc-definitions.test.ts:35`

**Interfaces:**
- Consumes: `agentAttachCommand(name, agent)` (Task 3, signature now requires `agent`); `Definition.agent` (Task 2).
- Produces: a new internal helper `resolveAgentForInstance(deps: { store: Pick<Store, 'listInstanceMeta' | 'getDefinitionSpec'> }, name: string): AgentId`, used by `instance:commands` (which does no other lookup). `instance:attach` does NOT call the helper — it already looks up `meta`/`spec` inline for credential re-registration and `workspaceDir`, so it reads `spec?.definition.agent` directly off that same lookup rather than querying the store twice. Not exported outside `ipc.ts`.

- [ ] **Step 1: Write the failing tests**

Add `agent: 'claude'` to every fixture in this task's file list (mechanical, same pattern as Task 2):

```ts
// tests/main/ipc.test.ts:70,96,108,115,117,128 — for each, insert agent: 'claude' before baseImage
// example (line 70):
definition: { id: 'd', name: 'n', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
// example (line 96, and similarly 108/115/128):
store.insertDefinitionSpec({ definition: { id: 'd1', name: 'Alpha', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] })
// line 117's def:import bundle entry (no agent — this is testing import of an OLDER bundle
// shape without the field, on purpose; leave this one as-is, it's covered by Task 8's
// agentFromBaseImage fallback in bundle.ts, not by this task)
```

```ts
// tests/main/ipc-lifecycle.test.ts:6
const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [], credentials: []
}
```

```ts
// tests/main/ipc-ports.test.ts:8
definition: { id: 'd1', name: 'P', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
```

```ts
// tests/main/ipc-definitions.test.ts:35
definition: { id: 'd1', name: 'prj-alpha', description: '', agent: 'claude', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' },
```

Add a new case to `tests/main/ipc.test.ts` proving the opencode-agent path (the actual behavior this task adds):

```ts
it('instance:attach resumes with the definition\'s own agent, not always claude', async () => {
  const store = openStore(':memory:')
  store.insertDefinitionSpec({
    definition: { id: 'd', name: 'n', description: '', agent: 'opencode', baseImage: 'docker.io/docker/sandbox-templates:opencode', tier: 'locked', createdAt: 't' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
  })
  store.upsertInstanceMeta({ sbxName: 'box', definitionId: 'd', createdByApp: true, createdAt: 't' })
  const openTerminal = vi.fn()
  const h = buildHandlers({ adapter, store, probes, openTerminal })
  await h['instance:attach']('box')
  expect(openTerminal).toHaveBeenCalledWith("sbx run --name 'box' -- --continue")
})
```

(This particular case still resolves to `--continue` because that's `AGENT_PROFILES.opencode.resumeArgs` too per Task 1 — the point of the test is that the handler now looks up the *instance's own* agent instead of a hardcoded constant; if Task 1's opencode `resumeArgs` value is ever corrected to something else, this test's expectation should be updated to match.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck && npx vitest run tests/main/ipc.test.ts tests/main/ipc-lifecycle.test.ts tests/main/ipc-ports.test.ts tests/main/ipc-definitions.test.ts`
Expected: FAIL — type errors from missing `agent` fields, plus `agentAttachCommand(name)` now requiring a second argument.

- [ ] **Step 3: Implement**

In `src/main/ipc.ts`, add the helper (near the top of the file, after imports, or directly above `buildHandlers`):

```ts
import type { AgentId } from '@shared/agents'

/** The agent to resume/attach with: the linked definition's own agent, or 'claude' when the
 * instance isn't tracked by the app (no definition to consult) — matching the app's
 * pre-multi-agent behavior for anything it doesn't manage. */
function resolveAgentForInstance(deps: { store: Pick<Store, 'listInstanceMeta' | 'getDefinitionSpec'> }, name: string): AgentId {
  const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
  const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
  return spec?.definition.agent ?? 'claude'
}
```

Update the two call sites:

```ts
'instance:attach': (name, opener) => wrap(async () => {
  const meta = deps.store.listInstanceMeta().find((m) => m.sbxName === name)
  const spec = meta?.definitionId ? deps.store.getDefinitionSpec(meta.definitionId) : null
  const cmd = agentAttachCommand(name, spec?.definition.agent ?? 'claude')
  // Re-register the definition's current credentials scoped to this instance so any
  // added/changed since the initial launch are synced into sbx before the agent runs.
  if (spec && deps.creds && meta?.definitionId && spec.credentials.length > 0) {
    await registerCredentials({ adapter: deps.adapter, creds: deps.creds, log: deps.log }, meta.definitionId, spec.credentials, name)
  }
  const workspaceDir = (spec?.mounts.find((m) => m.isPrimary) ?? spec?.mounts[0])?.hostPath?.trim()
  if (opener === 'vscode' && deps.openVSCode && workspaceDir) {
    deps.log?.info(`Opening VS Code at ${workspaceDir} to attach "${name}"`)
    deps.openVSCode(cmd, workspaceDir, name)
  } else {
    deps.log?.info(`Opening agent terminal: ${cmd}`)
    deps.openTerminal(cmd)
  }
  return null
}),
```

```ts
'instance:commands': (name) => wrap(async () => ({ agent: agentAttachCommand(name, resolveAgentForInstance(deps, name)), shell: hostShellCommand(name) })),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npx vitest run tests/main/ipc.test.ts tests/main/ipc-lifecycle.test.ts tests/main/ipc-ports.test.ts tests/main/ipc-definitions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts tests/main/ipc.test.ts tests/main/ipc-lifecycle.test.ts tests/main/ipc-ports.test.ts tests/main/ipc-definitions.test.ts
git commit -m "feat: resolve the instance's own agent for attach and manual commands"
```

---

### Task 8: `src/main/defio/bundle.ts` — carry `agent` through export/import

**Files:**
- Modify: `src/main/defio/bundle.ts:30-48`
- Modify (tests): `tests/main/defio/bundle.test.ts:6,52`

**Interfaces:**
- Consumes: `agentFromBaseImage` from `@shared/agents` (Task 1); `Definition.agent` (Task 2).
- Produces: `ExportableDefinition['definition']` gains `agent`; `normalizeEntry` backfills it for older bundles that predate this field.

- [ ] **Step 1: Write the failing test**

In `tests/main/defio/bundle.test.ts`, add `agent: 'claude'` to the existing fixture (line 6) and a new case proving the backfill for older bundles:

```ts
// line 6 — before/after
definition: { id, name, description: 'd', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
definition: { id, name, description: 'd', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' },
```

```ts
it('backfills agent from baseImage when importing an older bundle that predates the field', () => {
  const bundle = JSON.stringify({
    formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
    definitions: [{
      definition: { name: 'Old Export', description: '', baseImage: 'docker.io/docker/sandbox-templates:opencode', tier: 'locked' },
      mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    }]
  })
  const { definitions } = parseImportBundle(bundle)
  expect(definitions[0].definition.agent).toBe('opencode')
})
it('preserves an explicit agent from a newer bundle', () => {
  const bundle = JSON.stringify({
    formatVersion: '1', kind: 'sandbox-definitions', exportedAt: 'now',
    definitions: [{
      definition: { name: 'New Export', description: '', agent: 'codex', baseImage: 'my/custom:tag', tier: 'locked' },
      mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: []
    }]
  })
  const { definitions } = parseImportBundle(bundle)
  expect(definitions[0].definition.agent).toBe('codex')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck && npx vitest run tests/main/defio/bundle.test.ts`
Expected: FAIL — type error on the fixture missing `agent`, and the new cases failing since `normalizeEntry` doesn't read/backfill `agent` yet.

- [ ] **Step 3: Implement**

In `src/main/defio/bundle.ts`:

```ts
import type { DefinitionSpec } from '@shared/types'
import { agentFromBaseImage } from '@shared/agents'
```

```ts
function normalizeEntry(raw: unknown): ExportableDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const def = e.definition as Record<string, unknown> | undefined
  if (!def || typeof def.name !== 'string' || !def.name.trim() || typeof def.baseImage !== 'string' || typeof def.tier !== 'string') return null
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    definition: {
      name: def.name,
      description: typeof def.description === 'string' ? def.description : '',
      agent: typeof def.agent === 'string' ? (def.agent as DefinitionSpec['definition']['agent']) : agentFromBaseImage(def.baseImage),
      baseImage: def.baseImage,
      tier: def.tier as DefinitionSpec['definition']['tier']
    },
    mounts: arr(e.mounts), domains: arr(e.domains), ports: arr(e.ports),
    hostServices: arr(e.hostServices), credentials: arr(e.credentials),
    ssh: (e.ssh && typeof e.ssh === 'object' ? e.ssh : undefined) as ExportableDefinition['ssh'],
    kitCommandsYaml: typeof e.kitCommandsYaml === 'string' ? e.kitCommandsYaml : undefined
  }
}
```

`buildExportBundle` needs no change — it spreads `s.definition` minus `id`/`createdAt`, so `agent` passes through automatically.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/main/defio/bundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/defio/bundle.ts tests/main/defio/bundle.test.ts
git commit -m "feat: carry agent through definition export/import, backfilling older bundles"
```

---

## Final verification

- [ ] Run the full suite once more end-to-end: `npm run typecheck && npm test`. All green.
- [ ] Manual/acceptance (per the spec's Testing section — cannot be automated in this repo): launch an actual `opencode` sandbox end-to-end via the app and confirm it no longer hits the `500 Internal Server Error` from the original bug report. Do not claim codex/copilot work end-to-end until someone separately tests those templates — their `AGENT_PROFILES` entries remain best-effort placeholders (see Global Constraints).
