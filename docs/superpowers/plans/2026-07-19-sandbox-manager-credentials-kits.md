# Credentials & Kit-Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dead-end Credentials wizard step into a working, docs-grounded credential system: built-in **service** secrets stored via `sbx secret set`, **custom** secrets injected via an app-generated **mixin kit** (`spec.yaml`) launched with `--kit`, plus **global secrets** managed in Settings and **import-from-environment**.

**Architecture:** The app becomes a *kit generator*. At launch it (a) registers built-in service secret values via `sbx secret set` (keychain, stdin-piped, run from the Electron main process so no secret touches the terminal), and (b) generates a per-launch mixin kit encoding network policy + custom `serviceAuth`. The kit's `spec.yaml` is written to `<workspace>/.sandbox/kit/` (a gitignored artifacts folder). Each custom secret value is written to a `0600` host file **outside** the workspace (under `<userData>`), referenced by the kit's `credentials.sources.<id>.file.path` — **secret files must never live in `.sandbox/` because the workspace is mounted into the sandbox and the agent could read them directly, bypassing the proxy.** The sandbox is then created with `sbx create claude … --kit <dir>`. No secret value is ever stored in SQLite, written into the sandbox FS/mounted workspace, or placed in a terminal command string.

**Sandbox artifacts folder:** the app creates `<workspace>/.sandbox/` for its artifacts (`<workspace>/.sandbox/kit/spec.yaml` today; room for logs/manifests later) and appends `.sandbox` to `<workspace>/.gitignore` (idempotent) so it never gets committed.

**Tech Stack:** Electron (main/preload/renderer), React 18 + TypeScript strict, better-sqlite3, Vitest + @testing-library/react (jsdom), custom i18n. App-held secret storage via Electron `safeStorage` (no new native module).

## Global Constraints

- **Never store a secret value in SQLite.** Tables hold metadata only (service id, env var, header spec, domains, store kind, `has_app_copy`). Verbatim from architecture doc §Credentials.
- **Never put a secret in the native-terminal launch command.** The launch chain runs in Terminal.app via osascript; anything on that command line is visible in scrollback/`ps`. Secret registration happens in the Electron **main process** (stdin pipe) *before* the terminal opens; custom-secret values reach the kit via `0600` host files, not the command line.
- **`sbx reset` / `sbx policy reset` are FORBIDDEN** — they are global and destroy all sandboxes/secrets.
- **Only `SbxAdapter` spawns `sbx`; only `terminal.ts` owns osascript.** New secret/kit calls go through `SbxAdapter`.
- **Run the full test suite with `npm test`, never bare `npx vitest`.** `npm test`'s `pretest` hook flips better-sqlite3 to the Node ABI; bare vitest fails all DB tests (NODE_MODULE_VERSION mismatch).
- **Secret at-rest:** primary = OS keychain via `sbx secret set`; app-held fallback = Electron `safeStorage` (ciphertext file under `userData`). This deliberately replaces the architecture doc's `keytar` to avoid a second native module + the ABI-flip treadmill; the primary path is unchanged.
- **Built-in service kinds (authoritative env→domain map, from Docker docs):** `anthropic`→`ANTHROPIC_API_KEY`→api.anthropic.com, console.anthropic.com, claude.ai, mcp-proxy.anthropic.com · `openai`→`OPENAI_API_KEY`→api.openai.com, openai.com, chatgpt.com, www.chatgpt.com · `github`→`GH_TOKEN`/`GITHUB_TOKEN`→api.github.com, github.com · `google`→`GEMINI_API_KEY`/`GOOGLE_API_KEY`→generativelanguage.googleapis.com · plus `groq`, `mistral`, `nebius`, `openrouter`, `xai`, `cursor`, `droid`.
- **Scope semantics (from Docker docs):** `sbx secret set -g <service>` = global, applies only at sandbox *create*. `sbx secret set <sandbox> <service>` = sandbox-scoped, immediate. Custom: `sbx secret set-custom` OR kit four-block (we use the kit). Registry credentials are **out of scope** for this slice.
- **Kits:** `spec.yaml` at kit-dir root, `kind: mixin`, `schemaVersion: "1"`. Local kits are allowed by default (`kit.allowLocalKits=true`). Do **not** set `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` in a kit. Do **not** put secret values in `environment.variables`.
- **Artifacts vs. secrets location:** kit `spec.yaml` → `<workspace>/.sandbox/kit/`. Secret `0600` files → host-only dir **outside** the workspace (`<userData>/ai-sandbox-manager/secrets/<defId>/`). The workspace is mounted into the sandbox, so nothing secret may sit under `.sandbox/`. Always append `.sandbox` to `<workspace>/.gitignore` (idempotent, no duplicate line).

---

## File Structure

**New files:**
- `src/shared/services.ts` — `KNOWN_SERVICES` registry (id, label, envVars, domains) + lookup helpers. Shared by renderer (dropdown, domain hints, env scan) and main (kit domains, secret ids).
- `src/main/kit/generate.ts` — pure `buildKitSpec(spec)` → `{ specYaml: string, secretFiles: {relPath, envVar}[] }`. No I/O.
- `src/main/kit/write.ts` — writes the kit dir (`<workspace>/.sandbox/kit`) + `0600` secret files (host-only, outside the workspace); ensures `<workspace>/.gitignore` contains `.sandbox`; injected FS deps for testing.
- `src/main/creds/vault.ts` — `SecretVault` interface + `safeStorage`-backed impl + in-memory fake. App-held fallback store.
- `src/main/creds/manager.ts` — `CredentialManager`: `setGlobalService`, `removeGlobalService`, `stageDefinitionSecrets`, `scanEnv`. Orchestrates adapter + vault + store.
- `src/main/creds/env-scan.ts` — `scanHostEnv(deps)` reads a login-shell environment for known service vars.

**Modified files:**
- `src/shared/types.ts` — replace `CredentialKind`/`CredentialRef`; add `GlobalSecretMeta`.
- `src/main/store/db.ts` — migrate `credential_ref` (new columns), add `global_secret` table + CRUD; `user_version` 2 → 3.
- `src/main/sbx/adapter.ts` — add `setSecret`, `removeSecret`, `listSecrets` (all via `runSbx` + stdin).
- `src/main/sbx/translate.ts` — `launchCommand` gains `--kit <dir>`; domain union pulls credential/service domains.
- `src/main/launch.ts` — stage secrets + generate/write kit before opening terminal.
- `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/ipc/client.ts` — new `cred:*` / `secret:*` channels.
- `src/renderer/wizard/draft.ts` — new credential draft model + actions.
- `src/renderer/wizard/CreateDefinition.tsx` — rebuilt Credentials step (Service + Custom tabs, import).
- `src/renderer/screens/Settings.tsx` — global-secrets management UI.
- `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts` — new strings.
- `src/renderer/App.tsx` — wire wizard submit → credential IPC.

---

## Phase 0 — Spike (run once, before any implementation phase)

**This phase is manual and empirical.** It validates the kit + secret mechanism against the real `sbx` on the developer's machine. Its output is a short decision record checked into `docs/superpowers/plans/`. The launch-wiring phase (Phase 5) depends on its answers. Do **not** skip — several mechanism assumptions below are documented-but-unverified.

### ⚠️ SPIKE FINDINGS & VERDICT (run 2026-07-19, macOS, sbx real) — READ BEFORE TASK 4/11

The spike was run end-to-end (scenarios 1 and 2). Verified against real `sbx`:

| Mechanism | Result |
|---|---|
| `sbx create claude … --kit <dir>` | ✅ works |
| kit `environment.proxyManaged` → in-VM env var = `proxy-managed` sentinel | ✅ works |
| kit `network.allowedDomains` → domain reachable from sandbox | ✅ works |
| built-in service secret: `printf … \| sbx secret set -g <service>` (stdin) | ✅ works |
| **kit mixin `serviceAuth` (headerName/valueFormat) header injection for CUSTOM domains** | ❌ **DOES NOT INJECT** |
| **`sbx secret set-custom --host --env --value` (placeholder substitution)** | ✅ **works** |

**Evidence for the ❌:** with a mixin kit declaring `serviceDomains` + `serviceAuth` for `httpbin.org`/`postman-echo.com`, `sbx policy log` showed those domains as **`forward-bypass`** (TLS tunnelled, NOT intercepted) while a built-in service (`api.anthropic.com`) showed **`forward`** (intercepted). Echo tests confirmed the proxy neither **added** the header (httpbin `/headers` had no `X-Alpha-Key`) nor **overwrote** one the client sent (`X-Beta-Key: PLACEHOLDER` came back unchanged). Only `environment.proxyManaged` took effect (env vars were sentinels).

**Evidence for the ✅ (`set-custom`):** `sbx secret set-custom spike-multi --host postman-echo.com --env GAMMA_KEY --value realsecret-CCC` generated placeholder `sbx-cs-…`; sending `Authorization: Bearer sbx-cs-…` to postman-echo returned `"authorization":"Bearer realsecret-CCC"` — the proxy substituted the placeholder for the real secret in the request header.

**VERDICT — the design changes as follows (supersedes the Goal/Architecture header above for CUSTOM credentials):**

1. **Custom credentials use `sbx secret set-custom`, NOT kit `serviceAuth`.** The proxy swaps a generated placeholder (`sbx-cs-…`) for the real value wherever it appears in an outbound request to a matching `--host`. The env var is set to the placeholder at sandbox **creation** (so the secret must be registered before/at create — global `-g`, or recreate for sandbox scope).
2. **The generated kit keeps ONLY `network.allowedDomains`** (reachability). Drop `serviceDomains`, `serviceAuth`, `credentials.sources`, `environment.proxyManaged`, and the `0600` host secret files — none are needed, and serviceAuth doesn't inject. (If no other kit content remains, the kit may be replaced entirely by `sbx policy allow network`; keep the kit only if a network-allowlist kit is still preferred.)
3. **Service credentials are UNCHANGED** — `sbx secret set [-g] <service>` + the base kit inject correctly (`forward` path).
4. **Custom Secret UI loses Header Name / Value Format.** `set-custom` keys on host + env-var + value only; the agent chooses the header and the proxy substitutes the placeholder. Those two fields are dead under the real mechanism → remove them (pending the designer's updated mockup).

**Code deltas triggered (apply when doing Task 4 / Task 11 — do NOT treat the earlier task text as final):**
- `buildKitSpec` (Task 4): emit only `network.allowedDomains`; remove the serviceAuth four-block and `secretFiles`.
- `writeKit` (Task 5): no secret files to write; still writes the allowlist kit + `.gitignore` (or is dropped if we go policy-only).
- `SbxAdapter`: add `setCustomSecret(host: string[], env: string, value: string, scope)` → `sbx secret set-custom [-g|<sandbox>] --host … --env … --value …`.
- Data model: `CustomCredentialRef` drops `headers`; keeps `id`, `label`, `envVar`, `domains`, `store`.
- Renderer `CredentialsStep`: remove Header Name / Value Format inputs from the Custom tab.
- Task 11: register service creds via `secret set`, custom creds via `set-custom`, both from the main process before opening the terminal; kit (if kept) carries only allowedDomains.

**Open question deferred to the designer:** whether to keep the Custom Secret tab at all, or fold it into a single "add any API key" flow, now that host+env+value is the whole model.

### Task 0: Validate the kit + secret pipeline

**Files:**
- Create: `docs/superpowers/plans/2026-07-19-credentials-kits-spike-notes.md`

- [ ] **Step 1: Confirm `sbx create` accepts `--kit`.** In a scratch dir, create a minimal mixin kit `k/spec.yaml`:

```yaml
schemaVersion: "1"
kind: mixin
name: spike-net
displayName: Spike Net
network:
  allowedDomains:
    - example.com
```

Run: `sbx create claude "$PWD/scratch-ws" --name spike1 --kit ./k/` (use a throwaway workspace dir).
Record: does `create` accept `--kit`? If it rejects `--kit` on `create`, note whether `sbx run claude --kit ./k/ --name spike1` is the only entry point (changes Phase 5 to run-based provisioning).

- [ ] **Step 2: Confirm a `file:` credential source works.** Extend the kit to the custom four-block, pointing at a `0600` host file:

```yaml
schemaVersion: "1"
kind: mixin
name: spike-cred
displayName: Spike Cred
network:
  allowedDomains: [api.example.com]
  serviceDomains:
    api.example.com: spikesvc
  serviceAuth:
    spikesvc:
      headerName: Authorization
      valueFormat: "Bearer %s"
credentials:
  sources:
    spikesvc:
      file:
        path: "~/.spike-secret"
environment:
  proxyManaged: [SPIKE_API_KEY]
```

`printf 'testvalue' > ~/.spike-secret && chmod 600 ~/.spike-secret`
Run: `sbx create claude "$PWD/scratch-ws" --name spike2 --kit ./k/`, then `sbx exec spike2 -- printenv SPIKE_API_KEY`.
Record: is the in-sandbox value the sentinel (`proxy-managed`/`sbx-cs-…`) and NOT `testvalue`? Does `sbx policy log` show the proxy injecting to `api.example.com`? **This confirms host-file → kit injection works without the value entering the VM.**

- [ ] **Step 3: Confirm built-in service secret via stdin, global scope.** Run: `printf 'sk-test' | sbx secret set -g anthropic` then `sbx secret ls`.
Record: does stdin piping work (no interactive prompt)? Does `-g anthropic` appear in `ls`? Then `sbx secret rm -g anthropic -f` to clean up.

- [ ] **Step 4: Decide network-policy ownership.** With the kit's `network.allowedDomains` set, check via `sbx policy log` whether a *separate* `sbx policy allow network --sandbox <name> …` is still required, or whether kit `allowedDomains` alone governs egress.
Record the answer: **kit-owned policy** (drop the `sbx policy allow network` step in Phase 5) or **both** (keep it).

- [ ] **Step 5: Multi-service scenario — two API keys, two domains.** Validates the case `buildKitSpec` (Task 4) hits when a definition has 2+ custom credentials: multiple `serviceDomains` + `serviceAuth` + `credentials.sources` + `proxyManaged` entries, and **per-domain** injection (each domain gets only its own key). Uses two real header-echo services so the injected values are visible.

```bash
cd /tmp && rm -rf sbx-spike2 && mkdir -p sbx-spike2/ws sbx-spike2/k && cd sbx-spike2
printf 'alpha-secret-AAA' > ~/.spike-alpha && chmod 600 ~/.spike-alpha
printf 'beta-secret-BBB'  > ~/.spike-beta  && chmod 600 ~/.spike-beta
cat > k/spec.yaml <<'YAML'
schemaVersion: "1"
kind: mixin
name: spike-multi
displayName: Spike Multi
network:
  allowedDomains:
    - httpbin.org
    - postman-echo.com
  serviceDomains:
    httpbin.org: svc-alpha
    postman-echo.com: svc-beta
  serviceAuth:
    svc-alpha:
      headerName: X-Alpha-Key
      valueFormat: "Bearer %s"
    svc-beta:
      headerName: X-Beta-Key
      valueFormat: "%s"
credentials:
  sources:
    svc-alpha:
      file:
        path: "~/.spike-alpha"
    svc-beta:
      file:
        path: "~/.spike-beta"
environment:
  proxyManaged:
    - ALPHA_API_KEY
    - BETA_API_KEY
YAML
sbx create claude "$PWD/ws" --name spike-multi --kit ./k/
sbx exec spike-multi -- printenv ALPHA_API_KEY BETA_API_KEY               # both = sentinel, NOT the secrets
sbx exec spike-multi -- curl -s https://httpbin.org/headers               # expect X-Alpha-Key="Bearer alpha-secret-AAA", NO X-Beta-Key
sbx exec spike-multi -- curl -s https://postman-echo.com/get              # expect x-beta-key="beta-secret-BBB", NO X-Alpha-Key
sbx rm spike-multi --force; rm -f ~/.spike-alpha ~/.spike-beta; cd / && rm -rf /tmp/sbx-spike2
```

Success = (1) both env vars are sentinels; (2) httpbin echoes `X-Alpha-Key: Bearer alpha-secret-AAA` and **no** `X-Beta-Key`; (3) postman-echo echoes `x-beta-key: beta-secret-BBB` and **no** `X-Alpha-Key`. If injection instead requires the agent to send the header, or the value-format renders differently, record it — `buildKitSpec` (Task 4) must be adjusted to match.

- [ ] **Step 6: Clean up + write the decision record.** `sbx rm spike1 spike2 spike-multi --force` (any that remain); `rm -f ~/.spike-secret ~/.spike-alpha ~/.spike-beta`. Write `2026-07-19-credentials-kits-spike-notes.md` capturing the answers (Steps 1–5), and adjust Phase 5's tasks to match if reality differs from the assumptions. Commit:

```bash
git add docs/superpowers/plans/2026-07-19-credentials-kits-spike-notes.md
git commit -m "docs(spike): validate sbx kit + secret pipeline for credentials"
```

**Assumptions this plan proceeds on (correct in Phase 5 if the spike disproves them):** `sbx create … --kit <dir>` works; kit `credentials.sources.<id>.file.path` injects a host file host-side; multiple custom services inject **per-domain** (Step 5); `sbx secret set -g <service>` reads stdin; kit `allowedDomains` governs egress so the separate `policy allow network` step can be dropped.

---

## Phase 1 — Shared model

### Task 1: Known-services registry

**Files:**
- Create: `src/shared/services.ts`
- Test: `tests/shared/services.test.ts`

**Interfaces:**
- Produces: `interface KnownService { id: string; label: string; envVars: string[]; domains: string[] }`, `KNOWN_SERVICES: KnownService[]`, `serviceById(id: string): KnownService | undefined`, `serviceForEnvVar(name: string): KnownService | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/services.test.ts
import { describe, it, expect } from 'vitest'
import { KNOWN_SERVICES, serviceById, serviceForEnvVar } from '../../src/shared/services'

describe('KNOWN_SERVICES', () => {
  it('has anthropic with its canonical env var and domains', () => {
    const a = serviceById('anthropic')
    expect(a?.envVars).toContain('ANTHROPIC_API_KEY')
    expect(a?.domains).toContain('api.anthropic.com')
  })
  it('maps every env var back to exactly one service', () => {
    for (const svc of KNOWN_SERVICES)
      for (const v of svc.envVars) expect(serviceForEnvVar(v)?.id).toBe(svc.id)
  })
  it('resolves GitHub aliases', () => {
    expect(serviceForEnvVar('GITHUB_TOKEN')?.id).toBe('github')
    expect(serviceForEnvVar('GH_TOKEN')?.id).toBe('github')
  })
  it('has unique ids and no empty domains', () => {
    expect(new Set(KNOWN_SERVICES.map((s) => s.id)).size).toBe(KNOWN_SERVICES.length)
    for (const s of KNOWN_SERVICES) expect(s.domains.every((d) => d.length > 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- services`
Expected: FAIL — cannot find module `src/shared/services`.

- [ ] **Step 3: Implement the registry**

```ts
// src/shared/services.ts
// Canonical service → env-var → API-domain map. Domains mirror Docker Sandboxes'
// built-in service kits (docs.docker.com/ai/sandboxes/security/credentials). For
// built-in services the base `claude` kit owns the authoritative serviceAuth; the
// app uses these domains for the network allowlist and env import only.
export interface KnownService {
  id: string
  label: string
  envVars: string[]
  domains: string[]
}

export const KNOWN_SERVICES: KnownService[] = [
  { id: 'anthropic', label: 'Anthropic', envVars: ['ANTHROPIC_API_KEY'], domains: ['api.anthropic.com', 'console.anthropic.com', 'claude.ai', 'mcp-proxy.anthropic.com'] },
  { id: 'openai', label: 'OpenAI', envVars: ['OPENAI_API_KEY'], domains: ['api.openai.com', 'openai.com', 'chatgpt.com', 'www.chatgpt.com'] },
  { id: 'github', label: 'GitHub', envVars: ['GH_TOKEN', 'GITHUB_TOKEN'], domains: ['api.github.com', 'github.com'] },
  { id: 'google', label: 'Google', envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], domains: ['generativelanguage.googleapis.com'] },
  { id: 'groq', label: 'Groq', envVars: ['GROQ_API_KEY'], domains: ['api.groq.com'] },
  { id: 'mistral', label: 'Mistral', envVars: ['MISTRAL_API_KEY'], domains: ['api.mistral.ai'] },
  { id: 'nebius', label: 'Nebius', envVars: ['NEBIUS_API_KEY'], domains: ['api.studio.nebius.ai'] },
  { id: 'openrouter', label: 'OpenRouter', envVars: ['OPENROUTER_API_KEY'], domains: ['openrouter.ai'] },
  { id: 'xai', label: 'xAI', envVars: ['XAI_API_KEY'], domains: ['api.x.ai'] },
  { id: 'cursor', label: 'Cursor', envVars: ['CURSOR_API_KEY'], domains: ['api.cursor.com'] },
  { id: 'droid', label: 'Droid (Factory)', envVars: ['FACTORY_API_KEY'], domains: ['app.factory.ai'] }
]

export function serviceById(id: string): KnownService | undefined {
  return KNOWN_SERVICES.find((s) => s.id === id)
}

export function serviceForEnvVar(name: string): KnownService | undefined {
  return KNOWN_SERVICES.find((s) => s.envVars.includes(name))
}
```

> Note: domains for `groq`/`mistral`/`nebius`/`openrouter`/`xai`/`cursor`/`droid` are best-effort; the Phase 0 spike or `sbx` docs are the source of truth. Correct them if the spike surfaces the real domains. They only affect the network allowlist, not injection (the built-in kit injects).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- services`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/services.ts tests/shared/services.test.ts
git commit -m "feat(creds): add known-services registry (env vars + API domains)"
```

### Task 2: Credential + global-secret types

**Files:**
- Modify: `src/shared/types.ts:43-55`
- Test: `tests/shared/types-creds.test.ts`

**Interfaces:**
- Produces:
```ts
export type CredentialStore = 'sbx' | 'encrypted'
export interface ServiceCredentialRef { kind: 'service'; serviceId: string; envVar: string; store: CredentialStore }
export interface CustomHeader { name: string; format: string }        // format uses %s, e.g. "Bearer %s"
export interface CustomCredentialRef { kind: 'custom'; id: string; label: string; envVar: string; domains: string[]; headers: CustomHeader[]; store: CredentialStore }
export type CredentialRef = ServiceCredentialRef | CustomCredentialRef
export interface GlobalSecretMeta { id: string; label: string; envVar: string; store: CredentialStore; createdAt: string }
```
- Consumes: replaces old `CredentialKind = 'git'|'api-key'|'claude-auth'` and old `CredentialRef = { label; kind }`. `DefinitionSpec.credentials` stays `CredentialRef[]` (new shape).

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/types-creds.test.ts
import { describe, it, expect } from 'vitest'
import type { CredentialRef, GlobalSecretMeta } from '../../src/shared/types'

describe('credential types', () => {
  it('accepts a service credential', () => {
    const c: CredentialRef = { kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }
    expect(c.kind).toBe('service')
  })
  it('accepts a custom credential with headers', () => {
    const c: CredentialRef = { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'Authorization', format: 'Bearer %s' }], store: 'encrypted' }
    expect(c.kind === 'custom' && c.headers[0].format).toBe('Bearer %s')
  })
  it('accepts a global secret meta', () => {
    const g: GlobalSecretMeta = { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: '2026-07-19T00:00:00.000Z' }
    expect(g.envVar).toBe('OPENAI_API_KEY')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- types-creds`
Expected: FAIL — compile error (old types don't match / new types absent).

- [ ] **Step 3: Replace the credential types in `src/shared/types.ts`**

Replace the block currently at lines 43–55 (from `export type CredentialKind …` through the `DefinitionSpec` interface's `credentials` field) with:

```ts
export type CredentialStore = 'sbx' | 'encrypted'

/** A built-in service (anthropic, openai, …). Value lives in sbx keychain; base kit owns serviceAuth. */
export interface ServiceCredentialRef {
  kind: 'service'
  serviceId: string
  envVar: string
  store: CredentialStore
}

/** One proxy-rewritten header. `format` contains %s where the secret is substituted, e.g. "Bearer %s". */
export interface CustomHeader { name: string; format: string }

/** An arbitrary service. Injected via an app-generated mixin kit (serviceAuth four-block). */
export interface CustomCredentialRef {
  kind: 'custom'
  id: string          // kit service id — lowercase/alnum/hyphen, unique within a definition
  label: string
  envVar: string      // proxyManaged env var name inside the sandbox
  domains: string[]   // serviceDomains keys; wildcards *. / **. allowed
  headers: CustomHeader[]
  store: CredentialStore
}

export type CredentialRef = ServiceCredentialRef | CustomCredentialRef

/** A reusable secret managed in Settings (sbx `-g`). Metadata only — never the value. */
export interface GlobalSecretMeta {
  id: string          // service id, or a custom slug
  label: string
  envVar: string
  store: CredentialStore
  createdAt: string
}
```

Keep `DefinitionSpec.credentials: CredentialRef[]` (now the new shape).

- [ ] **Step 4: Run test + typecheck**

Run: `npm test -- types-creds && npm run typecheck`
Expected: the new test PASSES; typecheck now reports errors in `draft.ts`, `db.ts`, and old credential tests that use `{ label, kind }`. **That is expected** — those are fixed in Tasks 3, 11, and their own test updates. Note them; do not fix yet.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/shared/types-creds.test.ts
git commit -m "feat(creds): replace credential types with service/custom + global-secret meta"
```

---

## Phase 2 — Data model

### Task 3: Migrate `credential_ref`, add `global_secret`, extend Store CRUD

**Files:**
- Modify: `src/main/store/db.ts` (SCHEMA, `insertChildren`, `credentials` read at ~line 131, add global-secret CRUD)
- Test: `tests/main/store/db-creds.test.ts`

**Interfaces:**
- Consumes: `CredentialRef`, `GlobalSecretMeta` (Task 2); `DefinitionSpec`.
- Produces on `Store`: existing `insertDefinitionSpec`/`getDefinitionSpec` now round-trip the new `credentials`; new `listGlobalSecrets(): GlobalSecretMeta[]`, `upsertGlobalSecret(g: GlobalSecretMeta): void`, `deleteGlobalSecret(id: string): void`.

**Migration note:** the old `credential_ref(label, kind)` held only throwaway metadata (never a value). Bump `user_version` 2 → 3 by **dropping and recreating** `credential_ref` with the new columns and creating `global_secret`. Losing old label/kind rows is acceptable pre-release.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/store/db-creds.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openStore, type Store } from '../../../src/main/store/db'
import type { DefinitionSpec } from '../../../src/shared/types'

function baseSpec(id: string): DefinitionSpec {
  return {
    definition: { id, name: 'Proj', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains: [], ports: [],
    credentials: [
      { kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' },
      { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'Authorization', format: 'Bearer %s' }], store: 'encrypted' }
    ]
  }
}

let store: Store
beforeEach(() => { store = openStore(':memory:') })

describe('credential_ref round-trip', () => {
  it('persists and reloads service + custom credentials', () => {
    const spec = baseSpec('d1')
    store.insertDefinitionSpec(spec)
    const back = store.getDefinitionSpec('d1')
    expect(back?.credentials).toHaveLength(2)
    const svc = back!.credentials.find((c) => c.kind === 'service')
    expect(svc).toMatchObject({ serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' })
    const cust = back!.credentials.find((c) => c.kind === 'custom')
    expect(cust).toMatchObject({ id: 'acme', domains: ['api.acme.com'] })
    expect(cust && cust.kind === 'custom' && cust.headers[0]).toEqual({ name: 'Authorization', format: 'Bearer %s' })
  })
})

describe('global_secret CRUD', () => {
  it('upserts, lists, and deletes', () => {
    store.upsertGlobalSecret({ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: '2026-07-19T00:00:00.000Z' })
    store.upsertGlobalSecret({ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: '2026-07-19T01:00:00.000Z' }) // upsert, not duplicate
    expect(store.listGlobalSecrets()).toHaveLength(1)
    store.deleteGlobalSecret('openai')
    expect(store.listGlobalSecrets()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- db-creds`
Expected: FAIL — new columns / `global_secret` / CRUD methods don't exist.

- [ ] **Step 3: Update SCHEMA (in `src/main/store/db.ts`)**

Replace the `credential_ref` `CREATE TABLE` block and the `PRAGMA user_version = 2;` line with:

```sql
CREATE TABLE IF NOT EXISTS credential_ref (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'service' | 'custom'
  service_id TEXT,                 -- service kind
  cred_id TEXT,                    -- custom kind (kit service id)
  label TEXT NOT NULL DEFAULT '',
  env_var TEXT NOT NULL,
  domains TEXT NOT NULL DEFAULT '[]',   -- JSON array (custom)
  headers TEXT NOT NULL DEFAULT '[]',   -- JSON array of {name,format} (custom)
  store TEXT NOT NULL DEFAULT 'sbx',
  FOREIGN KEY (definition_id) REFERENCES definition(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS global_secret (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  env_var TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT 'sbx',
  created_at TEXT NOT NULL
);
PRAGMA user_version = 3;
```

Then add a migration run inside `openStore`, right after `db.exec(SCHEMA)`:

```ts
// Migrate pre-v3 credential_ref (old shape: label, kind) → new shape. Old rows held no
// secret value and only throwaway metadata, so a drop+recreate is safe pre-release.
const version = (db.pragma('user_version', { simple: true }) as number)
const cols = (db.prepare(`PRAGMA table_info(credential_ref)`).all() as { name: string }[]).map((c) => c.name)
if (!cols.includes('env_var')) {
  db.exec(`DROP TABLE IF EXISTS credential_ref;`)
  db.exec(SCHEMA)      // re-creates credential_ref (new shape) + global_secret
}
void version
```

- [ ] **Step 4: Update `insertChildren` credential insert (in `db.ts`)**

Replace the current `cIns` insert (the `INSERT INTO credential_ref (definition_id, label, kind) …` loop) with:

```ts
const cIns = db.prepare(
  `INSERT INTO credential_ref (definition_id, kind, service_id, cred_id, label, env_var, domains, headers, store)
   VALUES (?,?,?,?,?,?,?,?,?)`
)
for (const c of s.credentials) {
  if (c.kind === 'service') {
    cIns.run(s.definition.id, 'service', c.serviceId, null, '', c.envVar, '[]', '[]', c.store)
  } else {
    cIns.run(s.definition.id, 'custom', null, c.id, c.label, c.envVar, JSON.stringify(c.domains), JSON.stringify(c.headers), c.store)
  }
}
```

- [ ] **Step 5: Update the credential read in `getDefinitionSpec` (~line 131)**

Replace the `credentials` read with:

```ts
const credentials = (db.prepare(
  `SELECT kind, service_id AS serviceId, cred_id AS credId, label, env_var AS envVar, domains, headers, store
   FROM credential_ref WHERE definition_id = ? ORDER BY id`
).all(id) as Array<{ kind: string; serviceId: string | null; credId: string | null; label: string; envVar: string; domains: string; headers: string; store: string }>)
  .map((r): CredentialRef =>
    r.kind === 'service'
      ? { kind: 'service', serviceId: r.serviceId!, envVar: r.envVar, store: r.store as CredentialStore }
      : { kind: 'custom', id: r.credId!, label: r.label, envVar: r.envVar, domains: JSON.parse(r.domains), headers: JSON.parse(r.headers), store: r.store as CredentialStore })
```

Add `import type { CredentialRef, CredentialStore, GlobalSecretMeta } from '@shared/types'` to the top of `db.ts` if not already importing these.

- [ ] **Step 6: Add global-secret CRUD to the returned Store object (in `db.ts`)**

```ts
listGlobalSecrets(): GlobalSecretMeta[] {
  return db.prepare(`SELECT id, label, env_var AS envVar, store, created_at AS createdAt FROM global_secret ORDER BY created_at`).all() as GlobalSecretMeta[]
},
upsertGlobalSecret(g: GlobalSecretMeta): void {
  db.prepare(
    `INSERT INTO global_secret (id, label, env_var, store, created_at) VALUES (@id,@label,@envVar,@store,@createdAt)
     ON CONFLICT(id) DO UPDATE SET label=@label, env_var=@envVar, store=@store`
  ).run(g)
},
deleteGlobalSecret(id: string): void {
  db.prepare(`DELETE FROM global_secret WHERE id = ?`).run(id)
},
```

Add the three signatures to the exported `Store` type.

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test -- db-creds && npm run typecheck`
Expected: `db-creds` PASSES. Typecheck still flags `draft.ts` and old credential tests (fixed later).

- [ ] **Step 8: Commit**

```bash
git add src/main/store/db.ts tests/main/store/db-creds.test.ts
git commit -m "feat(creds): migrate credential_ref + add global_secret store CRUD"
```

---

## Phase 3 — Kit generation

### Task 4: Pure kit-spec builder

**Files:**
- Create: `src/main/kit/generate.ts`
- Test: `tests/main/kit/generate.test.ts`

**Interfaces:**
- Consumes: `DefinitionSpec`, `CustomCredentialRef`, `KNOWN_SERVICES` (for service domains).
- Produces:
```ts
export interface GeneratedKit {
  name: string                 // kit `name`
  specYaml: string             // full spec.yaml contents
  secretFiles: { relPath: string; envVar: string; credId: string }[]  // host files the writer must create (0600)
}
export function buildKitSpec(spec: DefinitionSpec): GeneratedKit
```
The builder is **pure** (no I/O). Secret *values* are not passed in — the builder only emits the kit and the list of files the writer must populate. Secret file paths are relative (`secrets/<credId>`); the writer resolves them under the kit dir and injects an absolute `file.path`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/kit/generate.test.ts
import { describe, it, expect } from 'vitest'
import { buildKitSpec } from '../../../src/main/kit/generate'
import type { DefinitionSpec } from '../../../src/shared/types'

function spec(creds: DefinitionSpec['credentials'], tier: DefinitionSpec['definition']['tier'] = 'locked', domains: string[] = []): DefinitionSpec {
  return {
    definition: { id: 'd1', name: 'Proj Alpha', description: '', baseImage: 'img:tag', tier, createdAt: '2026-07-19T00:00:00.000Z' },
    mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
    domains, ports: [], credentials: creds
  }
}

describe('buildKitSpec', () => {
  it('emits a mixin kit with schemaVersion 1', () => {
    const k = buildKitSpec(spec([]))
    expect(k.specYaml).toContain('schemaVersion: "1"')
    expect(k.specYaml).toContain('kind: mixin')
  })
  it('includes the custom four-block for a custom credential', () => {
    const k = buildKitSpec(spec([{ kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'Authorization', format: 'Bearer %s' }], store: 'encrypted' }]))
    expect(k.specYaml).toContain('serviceDomains:')
    expect(k.specYaml).toContain('api.acme.com: acme')
    expect(k.specYaml).toContain('headerName: Authorization')
    expect(k.specYaml).toContain('valueFormat: "Bearer %s"')
    expect(k.specYaml).toContain('proxyManaged:')
    expect(k.specYaml).toContain('ACME_KEY')
    expect(k.secretFiles).toEqual([{ relPath: 'secrets/acme', envVar: 'ACME_KEY', credId: 'acme' }])
  })
  it('adds service + custom + tier domains to allowedDomains, deduped', () => {
    const k = buildKitSpec(spec(
      [{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' },
       { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'X-Key', format: '%s' }], store: 'encrypted' }],
      'balanced', ['example.com']))
    expect(k.specYaml).toContain('api.anthropic.com')  // service domain
    expect(k.specYaml).toContain('api.acme.com')       // custom domain
    expect(k.specYaml).toContain('example.com')        // user domain
    // no duplicate lines
    const anthropicCount = (k.specYaml.match(/api\.anthropic\.com/g) || []).length
    expect(anthropicCount).toBeGreaterThanOrEqual(1)
  })
  it('emits no secretFiles when there are no custom credentials', () => {
    const k = buildKitSpec(spec([{ kind: 'service', serviceId: 'openai', envVar: 'OPENAI_API_KEY', store: 'sbx' }]))
    expect(k.secretFiles).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- kit/generate`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `buildKitSpec`**

```ts
// src/main/kit/generate.ts
// Pure generator: DefinitionSpec -> mixin kit spec.yaml + the list of host secret
// files the writer must create (0600). Custom credentials become the serviceAuth
// four-block (serviceDomains + serviceAuth + credentials.sources.file + proxyManaged);
// their values arrive host-side via file: sources so they never enter the VM.
import type { DefinitionSpec, CustomCredentialRef } from '@shared/types'
import { serviceById } from '@shared/names' // NOTE: import from '@shared/services' — see step note
import { BALANCED_BASELINE } from '../sbx/translate'

export interface GeneratedKit {
  name: string
  specYaml: string
  secretFiles: { relPath: string; envVar: string; credId: string }[]
}

function q(s: string): string { return JSON.stringify(s) } // YAML-safe double-quoted scalar

function customCreds(spec: DefinitionSpec): CustomCredentialRef[] {
  return spec.credentials.filter((c): c is CustomCredentialRef => c.kind === 'custom')
}

function allowedDomains(spec: DefinitionSpec): string[] {
  const svc = spec.credentials.flatMap((c) => (c.kind === 'service' ? (serviceDomains(c.serviceId)) : c.domains))
  const tierBase = spec.definition.tier === 'balanced' ? BALANCED_BASELINE : []
  const open = spec.definition.tier === 'open'
  const all = open ? ['**'] : [...tierBase, ...spec.domains, ...svc]
  return [...new Set(all.filter((d) => d.trim().length > 0))]
}

function serviceDomains(serviceId: string): string[] {
  const s = serviceById(serviceId)
  return s ? s.domains : []
}

export function buildKitSpec(spec: DefinitionSpec): GeneratedKit {
  const name = 'ai-sandbox-' + spec.definition.id.slice(0, 8)
  const customs = customCreds(spec)
  const domains = allowedDomains(spec)
  const lines: string[] = ['schemaVersion: "1"', 'kind: mixin', `name: ${name}`, `displayName: ${q(spec.definition.name)}`]

  const net: string[] = []
  if (domains.length) { net.push('  allowedDomains:'); for (const d of domains) net.push(`    - ${q(d)}`) }
  if (customs.length) {
    net.push('  serviceDomains:')
    for (const c of customs) for (const d of c.domains) net.push(`    ${d}: ${c.id}`)
    net.push('  serviceAuth:')
    for (const c of customs) {
      net.push(`    ${c.id}:`)
      // one header per service in this slice (first header); extra headers noted as follow-up
      const h = c.headers[0] ?? { name: 'Authorization', format: 'Bearer %s' }
      net.push(`      headerName: ${q(h.name)}`)
      net.push(`      valueFormat: ${q(h.format)}`)
    }
  }
  if (net.length) { lines.push('network:'); lines.push(...net) }

  if (customs.length) {
    lines.push('credentials:', '  sources:')
    for (const c of customs) { lines.push(`    ${c.id}:`, '      file:', `        path: ${q('secrets/' + c.id)}`) }
    lines.push('environment:', '  proxyManaged:')
    for (const c of customs) lines.push(`    - ${c.envVar}`)
  }

  return {
    name,
    specYaml: lines.join('\n') + '\n',
    secretFiles: customs.map((c) => ({ relPath: 'secrets/' + c.id, envVar: c.envVar, credId: c.id }))
  }
}
```

> **Import correction:** the snippet's first import is wrong on purpose to flag it — import `serviceById` from `'@shared/services'` (Task 1), not `'@shared/names'`. The writer (Task 5) rewrites the relative `secrets/<id>` path to an absolute host path before `sbx` reads it; `buildKitSpec` keeps it relative so the function stays pure and testable.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- kit/generate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/kit/generate.ts tests/main/kit/generate.test.ts
git commit -m "feat(kit): pure mixin-kit spec.yaml generator from a definition"
```

### Task 5: Kit writer (spec.yaml + 0600 secret files)

**Files:**
- Create: `src/main/kit/write.ts`
- Test: `tests/main/kit/write.test.ts`

**Interfaces:**
- Consumes: `GeneratedKit` (Task 4).
- Produces:
```ts
export interface KitFs {
  mkdir(path: string): void
  writeFile(path: string, data: string, mode: number): void
  readFile(path: string): string | null
  rm(path: string): void
}
export interface WriteKitDeps {
  fs: KitFs
  kitDir: string       // <workspace>/.sandbox/kit — spec.yaml goes here (mounted into sandbox)
  secretsDir: string   // host-only, OUTSIDE the workspace — secret files go here
  gitignorePath: string // <workspace>/.gitignore
}
export function writeKit(kit: GeneratedKit, secretValues: Record<string, string>, deps: WriteKitDeps): { kitDir: string; specYaml: string }
```
Writes `<kitDir>/spec.yaml` with each `file.path` rewritten to `<secretsDir>/<credId>` (absolute, host-only), writes each secret file there with mode `0o600`, and ensures `<gitignorePath>` contains a `.sandbox` line (append if absent, never duplicate). `secretValues` is keyed by `credId`; missing values throw (fail loud). **Secret files go to `secretsDir`, never under `kitDir`** — `kitDir` is inside the mounted workspace.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/kit/write.test.ts
import { describe, it, expect } from 'vitest'
import { writeKit, type KitFs } from '../../../src/main/kit/write'
import { buildKitSpec } from '../../../src/main/kit/generate'
import type { DefinitionSpec } from '../../../src/shared/types'

function fakeFs() {
  const files = new Map<string, { data: string; mode: number }>()
  const dirs = new Set<string>()
  const fs: KitFs = {
    mkdir: (p) => { dirs.add(p) },
    writeFile: (p, data, mode) => { files.set(p, { data, mode }) },
    readFile: (p) => (files.has(p) ? files.get(p)!.data : null),
    rm: (p) => { files.delete(p) }
  }
  return { fs, files, dirs }
}

const spec: DefinitionSpec = {
  definition: { id: 'deadbeefcafe', name: 'Proj', description: '', baseImage: 'i:t', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
  mounts: [{ hostPath: '/ws', mode: 'direct', isPrimary: true }], domains: [], ports: [],
  credentials: [{ kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'Authorization', format: 'Bearer %s' }], store: 'encrypted' }]
}
const deps = (fs: KitFs) => ({ fs, kitDir: '/ws/.sandbox/kit', secretsDir: '/userdata/secrets/deadbeefcafe', gitignorePath: '/ws/.gitignore' })

describe('writeKit', () => {
  it('writes spec.yaml in the kit dir but the 0600 secret file OUTSIDE the workspace', () => {
    const { fs, files } = fakeFs()
    const { kitDir, specYaml } = writeKit(buildKitSpec(spec), { acme: 's3cr3t' }, deps(fs))
    expect(kitDir).toBe('/ws/.sandbox/kit')
    // secret path points outside the workspace, not under .sandbox
    expect(specYaml).toContain('/userdata/secrets/deadbeefcafe/acme')
    expect(specYaml).not.toContain('.sandbox/kit/secrets')
    expect(specYaml).not.toContain('path: "secrets/acme"')
    const secret = files.get('/userdata/secrets/deadbeefcafe/acme')
    expect(secret?.data).toBe('s3cr3t')
    expect(secret?.mode).toBe(0o600)
    expect(files.get('/ws/.sandbox/kit/spec.yaml')?.data).toBe(specYaml)
  })
  it('appends .sandbox to .gitignore only once', () => {
    const { fs, files } = fakeFs()
    writeKit(buildKitSpec(spec), { acme: 'v' }, deps(fs))
    expect(files.get('/ws/.gitignore')?.data).toContain('.sandbox')
    // second launch must not duplicate the line
    writeKit(buildKitSpec(spec), { acme: 'v' }, deps(fs))
    expect((files.get('/ws/.gitignore')!.data.match(/^\.sandbox$/gm) || []).length).toBe(1)
  })
  it('throws when a required secret value is missing', () => {
    const { fs } = fakeFs()
    expect(() => writeKit(buildKitSpec(spec), {}, deps(fs))).toThrow(/acme/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- kit/write`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `writeKit`**

```ts
// src/main/kit/write.ts
// Materialises a GeneratedKit: spec.yaml into <workspace>/.sandbox/kit, and each
// secret value into a 0600 host file UNDER secretsDir (outside the workspace, so the
// mounted sandbox can't read it). Secret values live ONLY in these host files —
// never in SQLite, never in the mounted workspace, never on the terminal command line.
import type { GeneratedKit } from './generate'

export interface KitFs {
  mkdir(path: string): void
  writeFile(path: string, data: string, mode: number): void
  readFile(path: string): string | null
  rm(path: string): void
}
export interface WriteKitDeps { fs: KitFs; kitDir: string; secretsDir: string; gitignorePath: string }

function ensureGitignored(deps: WriteKitDeps): void {
  const existing = deps.fs.readFile(deps.gitignorePath) ?? ''
  const lines = existing.split('\n').map((l) => l.trim())
  if (lines.includes('.sandbox')) return
  const next = existing.length === 0 ? '.sandbox\n' : existing.replace(/\n?$/, '\n') + '.sandbox\n'
  deps.fs.writeFile(deps.gitignorePath, next, 0o644)
}

export function writeKit(
  kit: GeneratedKit,
  secretValues: Record<string, string>,
  deps: WriteKitDeps
): { kitDir: string; specYaml: string } {
  deps.fs.mkdir(deps.kitDir)

  let specYaml = kit.specYaml
  if (kit.secretFiles.length) {
    deps.fs.mkdir(deps.secretsDir)   // host-only, outside the workspace
    for (const f of kit.secretFiles) {
      const value = secretValues[f.credId]
      if (value === undefined) throw new Error(`missing secret value for custom credential "${f.credId}"`)
      const abs = `${deps.secretsDir}/${f.credId}`
      deps.fs.writeFile(abs, value, 0o600)
      specYaml = specYaml.replace(JSON.stringify(f.relPath), JSON.stringify(abs))
    }
  }
  deps.fs.writeFile(`${deps.kitDir}/spec.yaml`, specYaml, 0o644)
  ensureGitignored(deps)
  return { kitDir: deps.kitDir, specYaml }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- kit/write`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/kit/write.ts tests/main/kit/write.test.ts
git commit -m "feat(kit): write generated kit dir + 0600 secret files"
```

---

## Phase 4 — Secret plumbing (main process)

### Task 6: `SbxAdapter.setSecret` / `removeSecret` (stdin-piped)

**Files:**
- Modify: `src/main/sbx/adapter.ts`
- Test: `tests/main/sbx/adapter-secret.test.ts`

**Interfaces:**
- Consumes: existing `runSbx(args, opts?)` — `opts` already supports `stdin` (used elsewhere). Confirm `runSbx` writes `opts.stdin` to the child's stdin and closes it.
- Produces on `SbxAdapter`:
```ts
setSecret(service: string, value: string, opts: { global?: boolean; sandbox?: string }): Promise<void>
removeSecret(service: string, opts: { global?: boolean; sandbox?: string }): Promise<void>
```
`setSecret` runs `sbx secret set [-g | <sandbox>] <service>` with `value` on stdin. `removeSecret` runs `sbx secret rm [-g | <sandbox>] <service> -f`.

- [ ] **Step 1: Write the failing test** (inject a fake `SpawnFn` capturing args + stdin)

```ts
// tests/main/sbx/adapter-secret.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createSbxAdapter } from '../../../src/main/sbx/adapter'

function fakeSpawn() {
  const calls: { args: string[]; stdin?: string }[] = []
  const spawn = vi.fn((_cmd: string, args: string[], opts?: { stdin?: string }) => {
    calls.push({ args, stdin: opts?.stdin })
    return Promise.resolve({ stdout: '', stderr: '', code: 0 })
  })
  return { spawn, calls }
}

describe('adapter.setSecret / removeSecret', () => {
  it('pipes the value on stdin for a global service secret', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter({ spawn })
    await a.setSecret('anthropic', 'sk-ant-xyz', { global: true })
    expect(calls[0].args).toEqual(['secret', 'set', '-g', 'anthropic'])
    expect(calls[0].stdin).toBe('sk-ant-xyz')
  })
  it('uses the sandbox name when scoped', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter({ spawn })
    await a.setSecret('openai', 'v', { sandbox: 'my-box' })
    expect(calls[0].args).toEqual(['secret', 'set', 'my-box', 'openai'])
  })
  it('removes a global secret with -f', async () => {
    const { spawn, calls } = fakeSpawn()
    const a = createSbxAdapter({ spawn })
    await a.removeSecret('github', { global: true })
    expect(calls[0].args).toEqual(['secret', 'rm', '-g', 'github', '-f'])
  })
})
```

> Match `createSbxAdapter`'s real constructor shape — if it takes `{ spawn, log }` and a different factory name, mirror the existing adapter tests. Adjust the fake to whatever `runSbx`'s stdin option is actually named (Step 0 below).

- [ ] **Step 0: Read `src/main/sbx/adapter.ts`** to confirm the constructor/factory name, how `runSbx` receives stdin, and the `SpawnFn` signature. Align the test and impl to reality.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- adapter-secret`
Expected: FAIL — `setSecret` undefined.

- [ ] **Step 3: Implement the two methods** (add to the adapter object; mirror existing method style)

```ts
async setSecret(service: string, value: string, opts: { global?: boolean; sandbox?: string }): Promise<void> {
  const scope = opts.global ? ['-g'] : opts.sandbox ? [opts.sandbox] : []
  await this.runSbx(['secret', 'set', ...scope, service], { stdin: value })
},
async removeSecret(service: string, opts: { global?: boolean; sandbox?: string }): Promise<void> {
  const scope = opts.global ? ['-g'] : opts.sandbox ? [opts.sandbox] : []
  await this.runSbx(['secret', 'rm', ...scope, service, '-f'])
},
```

Add both signatures to the exported `SbxAdapter` type.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- adapter-secret`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/sbx/adapter.ts tests/main/sbx/adapter-secret.test.ts
git commit -m "feat(creds): sbx secret set/rm via adapter (stdin-piped)"
```

### Task 7: App-held secret vault (`safeStorage` + fake)

**Files:**
- Create: `src/main/creds/vault.ts`
- Test: `tests/main/creds/vault.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SecretVault {
  set(key: string, value: string): void
  get(key: string): string | null
  delete(key: string): void
}
export function createMemoryVault(): SecretVault                       // for tests + non-Electron
export function createSafeStorageVault(deps: { dir: string; safeStorage: ElectronSafeStorage; fs: VaultFs }): SecretVault
```
`safeStorage` vault encrypts each value (`safeStorage.encryptString`) and writes ciphertext to `<dir>/<sha of key>.bin`; `get` decrypts. Interface-injected so tests use the memory vault and never touch Electron.

- [ ] **Step 1: Write the failing test** (memory vault is enough to lock the contract)

```ts
// tests/main/creds/vault.test.ts
import { describe, it, expect } from 'vitest'
import { createMemoryVault } from '../../../src/main/creds/vault'

describe('SecretVault (memory)', () => {
  it('round-trips a value', () => {
    const v = createMemoryVault()
    v.set('acme', 's3cr3t')
    expect(v.get('acme')).toBe('s3cr3t')
  })
  it('returns null for a missing key and after delete', () => {
    const v = createMemoryVault()
    expect(v.get('nope')).toBeNull()
    v.set('x', '1'); v.delete('x')
    expect(v.get('x')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- creds/vault`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** `createMemoryVault` and `createSafeStorageVault`

```ts
// src/main/creds/vault.ts
import { createHash } from 'node:crypto'

export interface SecretVault {
  set(key: string, value: string): void
  get(key: string): string | null
  delete(key: string): void
}

export function createMemoryVault(): SecretVault {
  const m = new Map<string, string>()
  return {
    set: (k, v) => { m.set(k, v) },
    get: (k) => (m.has(k) ? m.get(k)! : null),
    delete: (k) => { m.delete(k) }
  }
}

// Electron main-process vault. safeStorage is OS-keychain-backed on macOS/Windows.
export interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}
export interface VaultFs {
  writeFile(path: string, data: Buffer, mode: number): void
  readFile(path: string): Buffer | null
  rm(path: string): void
  mkdir(path: string): void
}

export function createSafeStorageVault(deps: { dir: string; safeStorage: ElectronSafeStorage; fs: VaultFs }): SecretVault {
  deps.fs.mkdir(deps.dir)
  const file = (key: string) => `${deps.dir}/${createHash('sha256').update(key).digest('hex')}.bin`
  return {
    set: (k, v) => {
      if (!deps.safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
      deps.fs.writeFile(file(k), deps.safeStorage.encryptString(v), 0o600)
    },
    get: (k) => {
      const buf = deps.fs.readFile(file(k))
      return buf ? deps.safeStorage.decryptString(buf) : null
    },
    delete: (k) => { deps.fs.rm(file(k)) }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- creds/vault`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/creds/vault.ts tests/main/creds/vault.test.ts
git commit -m "feat(creds): app-held secret vault (safeStorage + memory fake)"
```

### Task 8: Host-environment scan for known service vars

**Files:**
- Create: `src/main/creds/env-scan.ts`
- Test: `tests/main/creds/env-scan.test.ts`

**Interfaces:**
- Consumes: `KNOWN_SERVICES`.
- Produces:
```ts
export interface EnvHit { serviceId: string; label: string; envVar: string; masked: string }
export function scanEnv(env: Record<string, string | undefined>): EnvHit[]
export function maskValue(v: string): string
```
`scanEnv` returns one hit per known service whose (first-present) env var has a non-empty value; `masked` shows the first 6 chars + `…`. Pure over an injected `env` map (the IPC layer passes a login-shell env; see Task 10).

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/creds/env-scan.test.ts
import { describe, it, expect } from 'vitest'
import { scanEnv, maskValue } from '../../../src/main/creds/env-scan'

describe('scanEnv', () => {
  it('finds anthropic + github (via alias) and masks values', () => {
    const hits = scanEnv({ ANTHROPIC_API_KEY: 'sk-ant-abcdef123', GH_TOKEN: 'gho_secret', UNRELATED: 'x' })
    const ids = hits.map((h) => h.serviceId)
    expect(ids).toContain('anthropic')
    expect(ids).toContain('github')
    const a = hits.find((h) => h.serviceId === 'anthropic')!
    expect(a.envVar).toBe('ANTHROPIC_API_KEY')
    expect(a.masked).toBe('sk-ant…')
    expect(a.masked).not.toContain('123')
  })
  it('ignores empty values and returns one hit per service', () => {
    expect(scanEnv({ OPENAI_API_KEY: '' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm test -- env-scan` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/main/creds/env-scan.ts
import { KNOWN_SERVICES } from '@shared/services'

export interface EnvHit { serviceId: string; label: string; envVar: string; masked: string }

export function maskValue(v: string): string {
  return v.length <= 6 ? '…' : v.slice(0, 6) + '…'
}

export function scanEnv(env: Record<string, string | undefined>): EnvHit[] {
  const hits: EnvHit[] = []
  for (const svc of KNOWN_SERVICES) {
    const envVar = svc.envVars.find((v) => (env[v] ?? '').trim().length > 0)
    if (envVar) hits.push({ serviceId: svc.id, label: svc.label, envVar, masked: maskValue(env[envVar]!.trim()) })
  }
  return hits
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npm test -- env-scan` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/creds/env-scan.ts tests/main/creds/env-scan.test.ts
git commit -m "feat(creds): scan host env for known service API keys"
```

### Task 9: Credential manager (orchestrator)

**Files:**
- Create: `src/main/creds/manager.ts`
- Test: `tests/main/creds/manager.test.ts`

**Interfaces:**
- Consumes: `SbxAdapter` (`setSecret`/`removeSecret`), `SecretVault`, `Store` (`upsertGlobalSecret`/`deleteGlobalSecret`/`listGlobalSecrets`), `serviceById`.
- Produces:
```ts
export interface CredentialManager {
  setGlobalService(serviceId: string, value: string): Promise<GlobalSecretMeta>   // sbx secret set -g + store meta
  removeGlobalSecret(id: string): Promise<void>                                    // sbx secret rm -g + delete meta
  listGlobalSecrets(): GlobalSecretMeta[]
  stageServiceValue(serviceId: string, value: string): void                        // vault.set for launch-time
  stageCustomValue(credId: string, value: string): void
  takeStaged(key: string): string | null                                           // vault.get + delete (one-shot)
}
export function createCredentialManager(deps: { adapter; vault; store }): CredentialManager
```
`setGlobalService` registers the value with `sbx secret set -g <serviceId>` then records `GlobalSecretMeta{ store:'sbx' }`. Per-definition secret *values* entered in the wizard are staged into the vault keyed `def:<serviceId|credId>` and consumed once at launch (Phase 5).

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/creds/manager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createCredentialManager } from '../../../src/main/creds/manager'
import { createMemoryVault } from '../../../src/main/creds/vault'

function fakes() {
  const adapter = { setSecret: vi.fn(async () => {}), removeSecret: vi.fn(async () => {}) }
  const gs: any[] = []
  const store = {
    upsertGlobalSecret: vi.fn((g) => { const i = gs.findIndex((x) => x.id === g.id); i >= 0 ? (gs[i] = g) : gs.push(g) }),
    deleteGlobalSecret: vi.fn((id) => { const i = gs.findIndex((x) => x.id === id); if (i >= 0) gs.splice(i, 1) }),
    listGlobalSecrets: vi.fn(() => gs)
  }
  return { adapter, store, vault: createMemoryVault() }
}

describe('CredentialManager', () => {
  it('setGlobalService pipes to sbx -g and records meta', async () => {
    const f = fakes()
    const m = createCredentialManager(f as any)
    const meta = await m.setGlobalService('anthropic', 'sk-ant-x')
    expect(f.adapter.setSecret).toHaveBeenCalledWith('anthropic', 'sk-ant-x', { global: true })
    expect(meta).toMatchObject({ id: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' })
    expect(f.store.upsertGlobalSecret).toHaveBeenCalled()
    expect(m.listGlobalSecrets()).toHaveLength(1)
  })
  it('removeGlobalSecret removes from sbx and store', async () => {
    const f = fakes()
    const m = createCredentialManager(f as any)
    await m.setGlobalService('github', 'gho_x')
    await m.removeGlobalSecret('github')
    expect(f.adapter.removeSecret).toHaveBeenCalledWith('github', { global: true })
    expect(m.listGlobalSecrets()).toHaveLength(0)
  })
  it('stages and takes a per-definition value one-shot', () => {
    const f = fakes()
    const m = createCredentialManager(f as any)
    m.stageServiceValue('openai', 'v')
    expect(m.takeStaged('def:openai')).toBe('v')
    expect(m.takeStaged('def:openai')).toBeNull() // consumed
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm test -- creds/manager` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/main/creds/manager.ts
import type { GlobalSecretMeta } from '@shared/types'
import { serviceById } from '@shared/services'
import type { SecretVault } from './vault'

interface Adapter { setSecret(s: string, v: string, o: { global?: boolean; sandbox?: string }): Promise<void>; removeSecret(s: string, o: { global?: boolean; sandbox?: string }): Promise<void> }
interface Store { upsertGlobalSecret(g: GlobalSecretMeta): void; deleteGlobalSecret(id: string): void; listGlobalSecrets(): GlobalSecretMeta[] }

export interface CredentialManager {
  setGlobalService(serviceId: string, value: string): Promise<GlobalSecretMeta>
  removeGlobalSecret(id: string): Promise<void>
  listGlobalSecrets(): GlobalSecretMeta[]
  stageServiceValue(serviceId: string, value: string): void
  stageCustomValue(credId: string, value: string): void
  takeStaged(key: string): string | null
}

export function createCredentialManager(deps: { adapter: Adapter; vault: SecretVault; store: Store; now?: () => number }): CredentialManager {
  const now = deps.now ?? (() => Date.now())
  return {
    async setGlobalService(serviceId, value) {
      const svc = serviceById(serviceId)
      if (!svc) throw new Error(`unknown service "${serviceId}"`)
      await deps.adapter.setSecret(serviceId, value, { global: true })
      const meta: GlobalSecretMeta = { id: serviceId, label: svc.label, envVar: svc.envVars[0], store: 'sbx', createdAt: new Date(now()).toISOString() }
      deps.store.upsertGlobalSecret(meta)
      return meta
    },
    async removeGlobalSecret(id) {
      await deps.adapter.removeSecret(id, { global: true })
      deps.store.deleteGlobalSecret(id)
    },
    listGlobalSecrets: () => deps.store.listGlobalSecrets(),
    stageServiceValue: (serviceId, value) => deps.vault.set(`def:${serviceId}`, value),
    stageCustomValue: (credId, value) => deps.vault.set(`def:${credId}`, value),
    takeStaged: (key) => { const v = deps.vault.get(key); if (v !== null) deps.vault.delete(key); return v }
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npm test -- creds/manager` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/creds/manager.ts tests/main/creds/manager.test.ts
git commit -m "feat(creds): credential manager (global secrets + staged values)"
```

---

## Phase 5 — Launch integration

> **Depends on Phase 0 spike.** The tasks below assume: `sbx create … --kit <dir>` works, and kit `allowedDomains` governs egress (so the `sbx policy allow network` step is dropped). If the spike found otherwise, adjust `launchCommand` accordingly (keep the policy step; or use `sbx run --kit` if `create` rejects `--kit`).

### Task 10: `launchCommand` takes a kit dir; drop redundant policy step

**Files:**
- Modify: `src/main/sbx/translate.ts` (`specToCreateArgs`, `launchCommand`)
- Test: `tests/main/sbx/translate-kit.test.ts`

**Interfaces:**
- Consumes: `DefinitionSpec`.
- Produces: `launchCommand(spec, name?, sessionName?, kitDir?)` — when `kitDir` is set, the `create` step appends `--kit <kitDir>` and the standalone `sbx policy allow network` step is omitted (kit owns `allowedDomains`). Ports still published via `sbx ports`. `specToCreateArgs(spec, name, kitDir?)` appends `--kit`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/sbx/translate-kit.test.ts
import { describe, it, expect } from 'vitest'
import { launchCommand } from '../../../src/main/sbx/translate'
import type { DefinitionSpec } from '../../../src/shared/types'

const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'proj', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], credentials: []
}

describe('launchCommand with a kit', () => {
  it('appends --kit to create and omits the standalone policy step', () => {
    const cmd = launchCommand(spec, 'proj', undefined, '/base/kits/ai-sandbox-d1')
    expect(cmd).toContain("--kit '/base/kits/ai-sandbox-d1'")
    expect(cmd).not.toContain('policy allow network')
    expect(cmd).toContain('sbx run --name proj')
  })
  it('without a kit keeps the existing behaviour', () => {
    const cmd = launchCommand(spec, 'proj')
    expect(cmd).not.toContain('--kit')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm test -- translate-kit` → FAIL.

- [ ] **Step 3: Implement.** Add an optional `kitDir` param to `specToCreateArgs` (push `'--kit', kitDir` when set) and to `launchCommand`:

```ts
export function launchCommand(
  spec: DefinitionSpec,
  name: string = resolveSandboxName(spec),
  sessionName?: string,
  kitDir?: string
): string {
  const steps: string[] = [shellCommand(['sbx', ...specToCreateArgs(spec, name, kitDir)])]
  if (!kitDir) {
    // Kit owns allowedDomains when present; only apply standalone policy without a kit.
    const resources = tierToAllowlist(spec.definition.tier, spec.domains)
    if (resources.length > 0) steps.push(shellCommand(['sbx', 'policy', 'allow', 'network', '--sandbox', name, resources.join(',')]))
  }
  for (const p of spec.ports) steps.push(shellCommand(['sbx', 'ports', name, '--publish', portIntentToPublishSpec(p)]))
  const runArgs = ['sbx', 'run', '--name', name]
  if (sessionName && sessionName.trim()) runArgs.push('--', '--name', sessionName.trim())
  steps.push(shellCommand(runArgs))
  return steps.join(' && ')
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npm test -- translate-kit` → PASS. Also `npm test -- translate` to confirm no existing translate test regressed (the no-kit path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/main/sbx/translate.ts tests/main/sbx/translate-kit.test.ts
git commit -m "feat(launch): launchCommand accepts a generated kit dir"
```

### Task 11: Wire secret staging + kit write into `launchDefinition`

**Files:**
- Modify: `src/main/launch.ts`
- Test: `tests/main/launch-creds.test.ts`

**Interfaces:**
- Consumes: `buildKitSpec` (Task 4), `writeKit` (Task 5), `CredentialManager.takeStaged` (Task 9), `launchCommand` kitDir param (Task 10), `Store.getDefinitionSpec`.
- Produces: `launchDefinition` deps gain a single injected `materializeKit(spec) => kitDir | undefined` seam (it internally uses `buildKitSpec` + `writeKit`). `materializeKit` derives paths from the spec's **primary mount** (the workspace): `kitDir = <workspace>/.sandbox/kit`, `secretsDir = <userData>/ai-sandbox-manager/secrets/<definitionId>`, `gitignorePath = <workspace>/.gitignore`. Behaviour:
  1. Load spec. If it has any credential, build the kit.
  2. For **service** credentials with a staged value, `sbx secret set -g <serviceId>` (main process, before terminal). (Per spike: global scope applies at create.)
  3. For **custom** credentials, collect staged values by `credId`, `writeKit(buildKitSpec(spec), values, …)` → `kitDir`.
  4. Open terminal with `launchCommand(spec, name, sessionName, kitDir)`.
  5. If a custom credential has no staged value, fail the launch with a clear error (don't launch a half-configured secret).

- [ ] **Step 1: Read `src/main/launch.ts`** to get the exact current `launchDefinition` signature and `LaunchDeps`. Extend, don't rewrite.

- [ ] **Step 2: Write the failing test** (inject fakes; assert order: secrets registered + kit written **before** `openTerminal`, and the command carries `--kit`)

```ts
// tests/main/launch-creds.test.ts
import { describe, it, expect, vi } from 'vitest'
import { launchDefinition } from '../../src/main/launch'

function deps(spec: any) {
  const events: string[] = []
  const adapter = { listSandboxes: vi.fn(async () => []) }
  const creds = {
    takeStaged: vi.fn((k: string) => (k === 'def:acme' ? 'acme-secret' : k === 'def:anthropic' ? 'sk-ant' : null)),
    setGlobalService: vi.fn(async () => { events.push('secret') })
  }
  const store = { getDefinitionSpec: vi.fn(() => spec), listInstanceMeta: vi.fn(() => []), insertInstanceMeta: vi.fn() }
  const materializeKit = vi.fn(() => { events.push('kit'); return '/base/kits/ai-sandbox-d1' })
  const openTerminal = vi.fn((cmd: string) => { events.push('terminal:' + cmd) })
  return { events, d: { adapter, creds, store, materializeKit, openTerminal } as any }
}

const spec = {
  definition: { id: 'd1', name: 'proj', description: '', baseImage: 'i:t', tier: 'locked', createdAt: '2026-07-19T00:00:00.000Z' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [],
  credentials: [
    { kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' },
    { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'Authorization', format: 'Bearer %s' }], store: 'encrypted' }
  ]
}

describe('launchDefinition with credentials', () => {
  it('registers global service secrets and writes the kit before opening the terminal, and passes --kit', async () => {
    const { events, d } = deps(spec)
    await launchDefinition(d, 'd1')
    expect(d.creds.setGlobalService).toHaveBeenCalledWith('anthropic', 'sk-ant')
    const termIdx = events.findIndex((e) => e.startsWith('terminal:'))
    expect(events.indexOf('secret')).toBeLessThan(termIdx)
    expect(events.indexOf('kit')).toBeLessThan(termIdx)
    expect(events[termIdx]).toContain("--kit '/base/kits/ai-sandbox-d1'")
  })
})
```

> Shape the injected deps to match however `launchDefinition` is actually structured after Step 1. The `materializeKit` seam keeps `launch.ts` testable without real FS. In production it is:
> ```ts
> (spec) => {
>   const ws = (spec.mounts.find(m => m.isPrimary) ?? spec.mounts[0]).hostPath
>   const kit = buildKitSpec(spec)
>   const values = Object.fromEntries(kit.secretFiles.map(f => {
>     const v = deps.creds.takeStaged(`def:${f.credId}`)
>     if (v === null) throw new SbxError('generic', `missing secret for "${f.credId}"`)
>     return [f.credId, v]
>   }))
>   return writeKit(kit, values, { fs: nodeKitFs, kitDir: `${ws}/.sandbox/kit`, secretsDir: `${userData}/ai-sandbox-manager/secrets/${spec.definition.id}`, gitignorePath: `${ws}/.gitignore` }).kitDir
> }
> ```
> Only build/write a kit when the spec has ≥1 custom credential; otherwise `materializeKit` returns `undefined` and `launchCommand` runs kit-less. Service credentials never need a kit (base kit owns their serviceAuth) — they only need `setGlobalService`.

- [ ] **Step 3: Run test to verify it fails** — Run: `npm test -- launch-creds` → FAIL.

- [ ] **Step 4: Implement** the credential handling in `launchDefinition` (before the existing `openTerminal` call), following the injected-deps pattern already in the file. Register service secrets, materialise the kit if any custom creds exist, thread `kitDir` into `launchCommand`. Throw a clear error if a custom credential's staged value is missing.

- [ ] **Step 5: Run test + full suite** — Run: `npm test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/launch.ts tests/main/launch-creds.test.ts
git commit -m "feat(launch): register service secrets + write kit before opening terminal"
```

---

## Phase 6 — IPC surface

### Task 12: `cred:*` / `secret:*` channels (main + preload + client)

**Files:**
- Modify: `src/main/ipc.ts` (add to `Deps`, handler map, registration)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/ipc/client.ts`
- Test: `tests/main/ipc-creds.test.ts`

**Interfaces (new channels, all returning `Result<T>`):**
```ts
'secret:listGlobal': () => Promise<Result<GlobalSecretMeta[]>>
'secret:setGlobal':  (serviceId: string, value: string) => Promise<Result<GlobalSecretMeta>>
'secret:removeGlobal': (id: string) => Promise<Result<null>>
'cred:scanEnv':      () => Promise<Result<EnvHit[]>>
'cred:stageValue':   (key: string, value: string) => Promise<Result<null>>   // key: 'service:<id>' | 'custom:<id>'
```
`Deps` gains `creds: CredentialManager` and `readLoginEnv: () => Record<string,string|undefined>`. `cred:scanEnv` = `scanEnv(deps.readLoginEnv())`. `cred:stageValue` maps `service:<id>`→`creds.stageServiceValue`, `custom:<id>`→`creds.stageCustomValue`.

- [ ] **Step 1: Read `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/ipc/client.ts`** to match the exact `Deps`, `wrap`, handler-map, `contextBridge` and `api` shapes.

- [ ] **Step 2: Write the failing test** (build handlers with fake deps; call each handler)

```ts
// tests/main/ipc-creds.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'

function deps() {
  const gs = [{ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: 't' }]
  const creds = {
    listGlobalSecrets: vi.fn(() => gs),
    setGlobalService: vi.fn(async (id: string) => ({ id, label: 'X', envVar: 'X_KEY', store: 'sbx', createdAt: 't' })),
    removeGlobalSecret: vi.fn(async () => {}),
    stageServiceValue: vi.fn(), stageCustomValue: vi.fn()
  }
  return {
    adapter: {} as any, store: {} as any, probes: {} as any, openTerminal: vi.fn(),
    creds, readLoginEnv: () => ({ ANTHROPIC_API_KEY: 'sk-ant-xyz' })
  } as any
}

describe('credential IPC handlers', () => {
  it('lists, sets, removes global secrets', async () => {
    const h = buildHandlers(deps())
    expect((await h['secret:listGlobal']()).ok).toBe(true)
    const set = await h['secret:setGlobal']('anthropic', 'sk')
    expect(set.ok).toBe(true)
    expect((await h['secret:removeGlobal']('openai')).ok).toBe(true)
  })
  it('scans env and stages a value', async () => {
    const h = buildHandlers(deps())
    const scan = await h['cred:scanEnv']()
    expect(scan.ok && scan.data.some((x: any) => x.serviceId === 'anthropic')).toBe(true)
    expect((await h['cred:stageValue']('service:openai', 'v')).ok).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails** — Run: `npm test -- ipc-creds` → FAIL.

- [ ] **Step 4: Implement handlers in `buildHandlers`** (mirror existing `wrap(...)` style):

```ts
'secret:listGlobal': () => wrap(async () => deps.creds.listGlobalSecrets()),
'secret:setGlobal': (serviceId: string, value: string) => wrap(async () => deps.creds.setGlobalService(serviceId, value)),
'secret:removeGlobal': (id: string) => wrap(async () => { await deps.creds.removeGlobalSecret(id); return null }),
'cred:scanEnv': () => wrap(async () => scanEnv(deps.readLoginEnv())),
'cred:stageValue': (key: string, value: string) => wrap(async () => {
  const [kind, id] = key.split(':', 2)
  if (kind === 'service') deps.creds.stageServiceValue(id, value)
  else if (kind === 'custom') deps.creds.stageCustomValue(id, value)
  else throw new Error(`bad stage key ${key}`)
  return null
}),
```

Add `import { scanEnv } from './creds/env-scan'`, extend the `Deps` interface (`creds`, `readLoginEnv`), and add all five to the handler-map type. Register each via `ipcMain.handle` in the same place the existing channels are registered.

- [ ] **Step 5: Wire preload** (`src/preload/index.ts`) — add to the exposed `api`:

```ts
secretListGlobal: () => ipcRenderer.invoke('secret:listGlobal'),
secretSetGlobal: (serviceId: string, value: string) => ipcRenderer.invoke('secret:setGlobal', serviceId, value),
secretRemoveGlobal: (id: string) => ipcRenderer.invoke('secret:removeGlobal', id),
credScanEnv: () => ipcRenderer.invoke('cred:scanEnv'),
credStageValue: (key: string, value: string) => ipcRenderer.invoke('cred:stageValue', key, value),
```

- [ ] **Step 6: Wire client** (`src/renderer/ipc/client.ts`) — add the matching typed methods to `api`, following the existing pattern (return `Result<T>`, guard for IPC-unavailable).

- [ ] **Step 7: Provide `readLoginEnv` + construct `creds` in the app entry** where `buildHandlers` is called (main entry, e.g. `src/main/index.ts`). `readLoginEnv` spawns a login shell once to capture the user's env (GUI apps don't inherit shell env on macOS):

```ts
import { execFileSync } from 'node:child_process'
function readLoginEnv(): Record<string, string | undefined> {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-lic', 'env'], { encoding: 'utf8', timeout: 4000 })
    const env: Record<string, string> = {}
    for (const line of out.split('\n')) { const i = line.indexOf('='); if (i > 0) env[line.slice(0, i)] = line.slice(i + 1) }
    return env
  } catch { return process.env }
}
```

Construct the vault (`createSafeStorageVault` with Electron `safeStorage` + a thin `node:fs` adapter, dir `<userData>/vault`) and `createCredentialManager({ adapter, vault, store })`, and pass `creds` + `readLoginEnv` into `buildHandlers`.

- [ ] **Step 8: Run test + typecheck + build** — Run: `npm test -- ipc-creds && npm run typecheck && npm run build` → PASS/clean.

- [ ] **Step 9: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc-creds.test.ts
git commit -m "feat(creds): IPC channels for global secrets, env scan, value staging"
```

---

## Phase 7 — Renderer UI

### Task 13: Wizard draft credential model

**Files:**
- Modify: `src/renderer/wizard/draft.ts` (`Draft.credentials` type, actions, reducer, `draftFromSpec`, `toSpec`)
- Test: `tests/renderer/wizard/draft-creds.test.ts`

**Interfaces:**
- The draft carries new-shape credentials plus a transient plaintext `value` that is **never** persisted to the spec (it is staged via IPC on submit — Task 16). Model:
```ts
interface DraftServiceCred { kind: 'service'; serviceId: string; envVar: string; value: string }
interface DraftCustomCred  { kind: 'custom'; id: string; label: string; envVar: string; domains: string[]; headers: { name: string; format: string }[]; value: string }
type DraftCred = DraftServiceCred | DraftCustomCred
// Draft.credentials: DraftCred[]
```
- New actions replace `addCredential`/`removeCredential`:
```ts
| { type: 'addServiceCred'; serviceId: string; envVar: string; value: string }
| { type: 'addCustomCred'; cred: DraftCustomCred }
| { type: 'removeCredential'; index: number }
```
- `toSpec(d)` maps `DraftCred[]` → `CredentialRef[]` dropping `value` and setting `store` (`service`→`'sbx'`, `custom`→`'encrypted'`). `draftFromSpec` maps back with `value: ''` (values aren't reloadable — they live in the vault/keychain).

- [ ] **Step 1: Read `src/renderer/wizard/draft.ts`** — note `toSpec` (find it; the earlier reads showed `draftFromSpec` and the reducer). Confirm where credentials are mapped both directions.

- [ ] **Step 2: Write the failing test**

```ts
// tests/renderer/wizard/draft-creds.test.ts
import { describe, it, expect } from 'vitest'
import { draftReducer, initialDraft, toSpec, draftFromSpec } from '../../../src/renderer/wizard/draft'

describe('draft credentials', () => {
  it('adds a service credential and maps to a CredentialRef without the value', () => {
    let d = initialDraft
    d = draftReducer(d, { type: 'addServiceCred', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', value: 'sk-ant' })
    expect(d.credentials).toHaveLength(1)
    const spec = toSpec({ ...d, workspace: '/p', name: 'p' } as any)
    expect(spec.credentials[0]).toEqual({ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' })
    expect(JSON.stringify(spec.credentials[0])).not.toContain('sk-ant')
  })
  it('adds a custom credential with headers', () => {
    let d = initialDraft
    d = draftReducer(d, { type: 'addCustomCred', cred: { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], headers: [{ name: 'Authorization', format: 'Bearer %s' }], value: 'v' } })
    const spec = toSpec({ ...d, workspace: '/p', name: 'p' } as any)
    expect(spec.credentials[0]).toMatchObject({ kind: 'custom', id: 'acme', domains: ['api.acme.com'] })
  })
  it('round-trips through draftFromSpec with empty values', () => {
    const spec = toSpec({ ...draftReducer(initialDraft, { type: 'addServiceCred', serviceId: 'openai', envVar: 'OPENAI_API_KEY', value: 'x' }), workspace: '/p', name: 'p' } as any)
    const d2 = draftFromSpec(spec)
    expect(d2.credentials[0]).toMatchObject({ kind: 'service', serviceId: 'openai', value: '' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails** — Run: `npm test -- draft-creds` → FAIL.

- [ ] **Step 4: Implement** — update `Draft.credentials` type, `initialDraft.credentials: []` (unchanged), the `DraftAction` union, the three reducer cases, and both mapping functions. Remove the old `addCredential` case and the old `CredentialKind` import.

- [ ] **Step 5: Run test + typecheck** — Run: `npm test -- draft-creds && npm run typecheck`. Typecheck will now flag `CreateDefinition.tsx` (old credentials step) — fixed in Task 14.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/wizard/draft.ts tests/renderer/wizard/draft-creds.test.ts
git commit -m "feat(wizard): new credential draft model (service/custom, transient value)"
```

### Task 14: Rebuild the Credentials wizard step (Service + Custom tabs + import)

**Files:**
- Create: `src/renderer/wizard/CredentialsStep.tsx` (extract the step into its own component)
- Modify: `src/renderer/wizard/CreateDefinition.tsx` (render `<CredentialsStep>` at `draft.step === 5`)
- Test: `tests/renderer/wizard/CredentialsStep.test.tsx`

**Interfaces:**
```ts
export function CredentialsStep({ credentials, onAddService, onAddCustom, onRemove, envHits, onImport }: {
  credentials: DraftCred[]
  onAddService: (serviceId: string, envVar: string, value: string) => void
  onAddCustom: (cred: DraftCustomCred) => void
  onRemove: (index: number) => void
  envHits: EnvHit[]
  onImport: (serviceId: string, scope: 'sandbox' | 'global') => void
}): JSX.Element
```
Layout follows the v5 mockup (`brainstorm/mockup/AI Sandbox Manager v5`, images `image.png` = Service row, `image-1.png` = registry-style custom row): a segmented control **Service | Custom**, then the active tab's inputs + **Add**, then the added-credentials list (removable), then an **Import from environment** section listing `envHits` with a scope select. `CredentialsStep` is presentational; the parent supplies `envHits` (fetched via `api.credScanEnv()` on step entry) and wires `onImport`/`onAdd*` into the reducer.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/renderer/wizard/CredentialsStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { CredentialsStep } from '../../../src/renderer/wizard/CredentialsStep'

const noop = () => {}
function setup(over: Partial<Parameters<typeof CredentialsStep>[0]> = {}) {
  const props = { credentials: [], onAddService: vi.fn(), onAddCustom: vi.fn(), onRemove: vi.fn(), envHits: [], onImport: vi.fn(), ...over }
  render(<CredentialsStep {...(props as any)} />)
  return props
}

describe('CredentialsStep', () => {
  it('adds a service credential from the Service tab', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk-ant-xyz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddService).toHaveBeenCalledWith('anthropic', 'ANTHROPIC_API_KEY', 'sk-ant-xyz')
  })
  it('switches to the Custom tab and adds a custom credential with a header', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('Host / Domain'), { target: { value: 'api.acme.com' } })
    fireEvent.change(screen.getByLabelText('Environment Variable'), { target: { value: 'ACME_KEY' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'v' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddCustom).toHaveBeenCalledWith(expect.objectContaining({ kind: 'custom', envVar: 'ACME_KEY', domains: ['api.acme.com'] }))
  })
  it('renders added credentials and removes one', () => {
    const p = setup({ credentials: [{ kind: 'service', serviceId: 'openai', envVar: 'OPENAI_API_KEY', value: '' }] as any })
    expect(screen.getByText(/OpenAI/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(p.onRemove).toHaveBeenCalledWith(0)
  })
  it('lists env hits and imports one', () => {
    const p = setup({ envHits: [{ serviceId: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', masked: 'sk-ant…' }] })
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    expect(p.onImport).toHaveBeenCalledWith('anthropic', expect.any(String))
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm test -- CredentialsStep` → FAIL.

- [ ] **Step 3: Implement `CredentialsStep`** using the existing wizard input classes/patterns and `KNOWN_SERVICES` for the Service `<select>` (option label `${s.label} — ${s.envVars[0]}`, plus the domains hint line). Service tab: `aria-label="Service"` select, masked `aria-label="Value"` input, **Add** → `onAddService(serviceId, service.envVars[0], value)`. Custom tab (role `tab`): `aria-label="Host / Domain"`, `aria-label="Environment Variable"`, header name + `valueFormat` (default `Bearer %s`), `aria-label="Value"`, **Add** → builds a `DraftCustomCred` with `id = toSbxName(host||label)`. Added list: one row per credential (service shows `KNOWN_SERVICES` label; custom shows label + domains), each with a Remove button. Import section: one row per `envHit` (label, envVar, masked value, scope `<select>` sandbox/global, **Import** → `onImport`). Match the mockup markup in `index.html` (Credentials panel, lines ~1861–2093).

- [ ] **Step 4: Wire into `CreateDefinition.tsx`** — replace the `draft.step === 5` block with `<CredentialsStep credentials={draft.credentials} onAddService={…dispatch} onAddCustom={…dispatch} onRemove={…dispatch} envHits={envHits} onImport={…} />`. Add an effect that fetches `api.credScanEnv()` when the wizard reaches step 5 and stores `envHits` in local state. On import, dispatch `addServiceCred` (with masked-only placeholder — the actual value stays host-side) and, for `global` scope, call `api.secretSetGlobal` is **not** done here (import uses `sbx secret import` semantics; for this slice, import adds a service credential referencing the env var, and the value is staged at submit).

- [ ] **Step 5: Run test to verify it passes** — Run: `npm test -- CredentialsStep` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/wizard/CredentialsStep.tsx src/renderer/wizard/CreateDefinition.tsx tests/renderer/wizard/CredentialsStep.test.tsx
git commit -m "feat(wizard): rebuild Credentials step with Service/Custom tabs + import"
```

### Task 15: Settings — global secrets management

**Files:**
- Create: `src/renderer/screens/GlobalSecrets.tsx`
- Modify: `src/renderer/screens/Settings.tsx` (render `<GlobalSecrets>` below the settings rows)
- Test: `tests/renderer/GlobalSecrets.test.tsx`

**Interfaces:**
```ts
export function GlobalSecrets({ secrets, onAdd, onRemove }: {
  secrets: GlobalSecretMeta[]
  onAdd: (serviceId: string, value: string) => void
  onRemove: (id: string) => void
}): JSX.Element
```
`Settings.tsx` owns the data: on mount `api.secretListGlobal()`; `onAdd` → `api.secretSetGlobal(serviceId, value)` then refresh; `onRemove` → confirm modal → `api.secretRemoveGlobal(id)` then refresh. `GlobalSecrets` is presentational.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/renderer/GlobalSecrets.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GlobalSecrets } from '../../src/renderer/screens/GlobalSecrets'

describe('GlobalSecrets', () => {
  it('lists secrets and adds one', () => {
    const onAdd = vi.fn(); const onRemove = vi.fn()
    render(<GlobalSecrets secrets={[{ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: 't' }]} onAdd={onAdd} onRemove={onRemove} />)
    expect(screen.getByText(/OpenAI/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledWith('anthropic', 'sk')
  })
  it('removes a secret', () => {
    const onRemove = vi.fn()
    render(<GlobalSecrets secrets={[{ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: 't' }]} onAdd={vi.fn()} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onRemove).toHaveBeenCalledWith('openai')
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm test -- GlobalSecrets` → FAIL.

- [ ] **Step 3: Implement `GlobalSecrets`** (service `<select>` from `KNOWN_SERVICES` + masked value + Add; a list of secrets showing label + envVar + masked/`•••` + Remove) and wire the data-owning effects into `Settings.tsx`. Follow the mockup's Settings `global-secrets` section (`index.html` ~line 2585–2596).

- [ ] **Step 4: Run test to verify it passes** — Run: `npm test -- GlobalSecrets` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/screens/GlobalSecrets.tsx src/renderer/screens/Settings.tsx tests/renderer/GlobalSecrets.test.tsx
git commit -m "feat(settings): manage global secrets"
```

---

## Phase 8 — i18n, submit wiring, finalize

### Task 16: Stage credential values on wizard submit

**Files:**
- Modify: `src/renderer/App.tsx` (definition create/edit submit path) or `src/renderer/wizard/CreateDefinition.tsx` submit handler
- Test: `tests/renderer/wizard/submit-creds.test.tsx`

**Interfaces:**
- On submit, after `api.defCreate`/`api.defUpdate` succeeds, for each draft credential with a non-empty `value`, call `api.credStageValue('service:<serviceId>' | 'custom:<credId>', value)`. This puts the value in the vault so the next launch can consume it. The spec saved to SQLite already excludes values (Task 13).

- [ ] **Step 1: Read the wizard submit handler** (`CreateDefinition.tsx` — the `submit` that branches `defUpdate`/`defCreate`).

- [ ] **Step 2: Write the failing test** — mock `api.credStageValue`; render the wizard through to submit with one service credential (value set); assert `credStageValue('service:anthropic', 'sk-ant')` was called after create. (Follow the existing wizard submit test's harness.)

- [ ] **Step 3: Run test to verify it fails** — Run: `npm test -- submit-creds` → FAIL.

- [ ] **Step 4: Implement** the staging loop in the submit success branch.

- [ ] **Step 5: Run test to verify it passes** — Run: `npm test -- submit-creds` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/wizard/CreateDefinition.tsx src/renderer/App.tsx tests/renderer/wizard/submit-creds.test.tsx
git commit -m "feat(wizard): stage credential values to the vault on submit"
```

### Task 17: i18n strings (en + de)

**Files:**
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`

**Interfaces:**
- Add keys used by Tasks 14 & 15. `de.ts` must stay parity-typed (`de: Dict`). Add under a `credentials` and `secrets` namespace, e.g.:
```ts
credentials: {
  tabService: 'Service', tabCustom: 'Custom',
  service: 'Service', value: 'Value', add: 'Add', remove: 'Remove',
  host: 'Host / Domain', envVar: 'Environment Variable', headerName: 'Header Name', valueFormat: 'Value Format',
  importTitle: 'Import from environment variables', scopeSandbox: 'This sandbox', scopeGlobal: 'Global', import: 'Import',
  none: 'No credentials added.'
},
secrets: { title: 'Global secrets', subtitle: 'Reusable API keys stored in your OS keychain (via sbx -g).', add: 'Add', remove: 'Remove', removeTitle: 'Remove global secret', removeBody: 'Remove "{label}"? Sandboxes referencing it will lose access on next launch.' }
```

- [ ] **Step 1: Add the keys to `en.ts`**, then the German equivalents to `de.ts` (translate; keep the same key structure).
- [ ] **Step 2: Run typecheck** — Run: `npm run typecheck`. The `de: Dict` parity check fails if any key is missing → add it. Expected: clean.
- [ ] **Step 3: Replace hard-coded strings** in `CredentialsStep.tsx`/`GlobalSecrets.tsx` with `t('credentials.*')` / `t('secrets.*')` (keep the `aria-label`s literal English where tests assert them, or update tests to `getByLabelText(t(...))` — simplest: keep aria-labels literal and use `t()` for visible text).
- [ ] **Step 4: Run tests** — Run: `npm test` → all PASS.
- [ ] **Step 5: Commit**

```bash
git add src/renderer/i18n/en.ts src/renderer/i18n/de.ts src/renderer/wizard/CredentialsStep.tsx src/renderer/screens/GlobalSecrets.tsx
git commit -m "i18n(creds): add credential + global-secret strings (en/de)"
```

### Task 18: Green-suite verification + finish

- [ ] **Step 1: Full suite** — Run: `npm test`. Expected: all PASS (includes every new test + the pre-existing 145). Fix any old credential test still using `{ label, kind }` (update to the new shape).
- [ ] **Step 2: Typecheck + build** — Run: `npm run typecheck && npm run build`. Expected: clean + build succeeds.
- [ ] **Step 3: Manual smoke (per spike outcome)** — start `npm run dev`; create a definition with (a) an Anthropic service credential (value entered) and (b) a custom credential (`api.acme.com`, `ACME_KEY`, `Authorization: Bearer %s`, value entered); Launch. Confirm: the opened terminal command contains `--kit <workspace>/.sandbox/kit`; `sbx secret ls` shows the anthropic global secret; `<workspace>/.sandbox/kit/spec.yaml` has the four-block with an **absolute** `file.path` pointing **outside** the workspace (under `<userData>/…/secrets/<defId>/acme`, mode `0600`); `<workspace>/.gitignore` contains `.sandbox` (exactly once); and there is **no** secret file anywhere under `<workspace>/.sandbox/`. No secret value appears in the terminal command or in SQLite (`credential_ref` has no value column). Inside the sandbox, `printenv ACME_KEY` shows the sentinel, not the real value.
- [ ] **Step 4: REQUIRED SUB-SKILL** — Use superpowers:finishing-a-development-branch to verify tests, present merge/PR options, and complete the branch.

---

## Self-Review

**1. Spec coverage (v5 mockup + user decisions):**
- Service credentials (dropdown, env var, domains hint, value) → Tasks 1, 14. ✓
- Custom secrets (host, env var, header + `Bearer %s`) via generated kit → Tasks 4, 5, 14. ✓
- Import-from-environment → Tasks 8, 12, 14. ✓
- Global secrets in Settings → Tasks 3, 9, 12, 15. ✓
- Registry credential → **out of scope** (user decision). Noted, not planned. ✓
- Secrets never in SQLite / never in terminal / keychain-or-encrypted → Global Constraints + Tasks 3, 5, 7, 11. ✓
- Data model updated → Tasks 2, 3, 13. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases". The one deliberate wrong import in Task 4 Step 3 is explicitly flagged with the correction immediately below it. Two tasks (10, 11) are gated on the Phase 0 spike and say so.

**3. Type consistency:** `CredentialRef` (`service`/`custom`), `GlobalSecretMeta`, `KnownService`, `GeneratedKit`, `SecretVault`, `CredentialManager`, `EnvHit` are defined once (Tasks 1, 2, 4, 7, 8, 9) and consumed with the same field names throughout. `store` values are `'sbx'|'encrypted'`. Kit service id = `custom.id`. Stage keys are `service:<id>` / `custom:<id>` (IPC) mapped to vault keys `def:<id>` (manager) — note the intentional prefix difference between the IPC key and the vault key.

**Known risks carried into execution:**
- Phase 0 spike may invalidate the `--kit`-on-`create` or kit-owns-policy assumptions → adjust Tasks 10–11.
- `KNOWN_SERVICES` domains for minor providers are best-effort → correct against `sbx` docs.
- `readLoginEnv` via `$SHELL -lic env` is macOS/Linux; Windows env import degrades to `process.env`.

---

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. Best for an 18-task, security-sensitive plan.
2. **Inline Execution** — batch execution in this session with checkpoints.

**Phase 0 (the spike) must run first regardless** — it needs a human at a machine with `sbx` installed and authenticated.
