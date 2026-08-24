# Burp Traffic Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-sandbox toggle that routes a running sandbox's HTTP(S) traffic through Burp Suite on the host, without breaking sbx's credential injection.

**Architecture:** A host-side session manager spawns one supervised `ssh <name>.sbx` child holding `-L <upstream>:127.0.0.1:<relay>`, whose remote command runs two `socat` relays inside the sandbox. Everything that is not a port forward (CA install, profile write, verification, teardown) goes through the existing `SbxAdapter.execScript`/`execCapture`. All logic except the session manager is pure and unit-tested; the session manager is tested with injected fakes.

**Tech Stack:** TypeScript (strict), Electron 33, React 18, vitest + @testing-library/react, better-sqlite3 (existing `app_prefs` table only).

**Spec:** `docs/superpowers/specs/2026-08-24-burp-traffic-capture-design.md`

## Global Constraints

- `npm run typecheck` and `npm test` must both pass before any task is considered complete.
- TypeScript `strict` is on. No `any` in new code; use `unknown` + narrowing.
- Every new user-facing string must be added to **both** `src/renderer/i18n/en.ts` and `src/renderer/i18n/de.ts`. A key present in one and missing from the other is a bug.
- **No database schema migration.** All persisted settings use the existing `app_prefs` table via `store.getPref` / `store.setPref`. Keys: `burp.caPath`, `burp.proxyPort`, `burp.upstreamPort`.
- **Exactly one capture session may exist at a time**, enforced in the session manager.
- **Fail closed:** if the credential-chain check fails, tear the tunnel down rather than leaving it up.
- The profile script's liveness check must match `/proc/net/tcp` state `0A` (LISTEN) **exactly**. A looser match also matches `TIME_WAIT` sockets and reports a dead tunnel as live, which breaks egress. This is measured behaviour, not caution.
- Port defaults: proxy `8080`, upstream `3128`, relay `3129`, app `18080`.
- Implementation must be platform-neutral (no PowerShell, no `openssl` dependency). It is verified on Windows only; do not add macOS-specific branches.
- Follow existing repo patterns: script builders like `src/main/sbx/fs-probe.ts`, output parsers like `src/main/sbx/policy-log.ts`, IPC via `buildHandlers` + `registerIpc` + preload + `src/renderer/ipc/client.ts`.

---

### Task 1: Shared capture types and settings store

**Files:**
- Create: `src/shared/capture.ts`
- Create: `src/main/capture/settings.ts`
- Test: `tests/main/capture/settings.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `CAPTURE_DEFAULTS: { proxyPort: 8080; upstreamPort: 3128; relayPort: 3129; appPort: 18080 }`
  - `RELAY_PORT_CANDIDATES: number[]`, `APP_PORT_CANDIDATES: number[]`
  - `interface BurpSettings { caPath: string; proxyPort: number; upstreamPort: number }`
  - `type CapturePhase = 'preflight' | 'ca' | 'profile' | 'tunnel' | 'verify'`
  - `type CaptureState = 'off' | 'starting' | 'on' | 'error'`
  - `interface CaptureCheck { id: string; ok: boolean; detail: string }`
  - `interface CapturePorts { proxy: number; upstream: number; relay: number; app: number }`
  - `interface CaptureStatus { sandbox: string | null; state: CaptureState; phase?: CapturePhase; checks: CaptureCheck[]; message?: string; ports?: CapturePorts }`
  - `interface PrefStore { getPref(key: string): string | null; setPref(key: string, value: string): void }`
  - `readBurpSettings(store: PrefStore): BurpSettings`
  - `writeBurpSettings(store: PrefStore, patch: Partial<BurpSettings>): BurpSettings`
  - `isValidPort(n: unknown): n is number`

- [ ] **Step 1: Write the failing test**

Create `tests/main/capture/settings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readBurpSettings, writeBurpSettings, isValidPort } from '../../../src/main/capture/settings'
import { CAPTURE_DEFAULTS } from '../../../src/shared/capture'

function fakeStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getPref: (k: string) => map.get(k) ?? null,
    setPref: (k: string, v: string) => { map.set(k, v) },
    all: () => Object.fromEntries(map)
  }
}

describe('isValidPort', () => {
  it('accepts 1..65535 integers only', () => {
    expect(isValidPort(8080)).toBe(true)
    expect(isValidPort(1)).toBe(true)
    expect(isValidPort(65535)).toBe(true)
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(65536)).toBe(false)
    expect(isValidPort(80.5)).toBe(false)
    expect(isValidPort('8080')).toBe(false)
    expect(isValidPort(NaN)).toBe(false)
  })
})

describe('readBurpSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readBurpSettings(fakeStore())).toEqual({
      caPath: '',
      proxyPort: CAPTURE_DEFAULTS.proxyPort,
      upstreamPort: CAPTURE_DEFAULTS.upstreamPort
    })
  })

  it('reads stored values', () => {
    const s = fakeStore({ 'burp.caPath': 'C:/ca.cer', 'burp.proxyPort': '8081', 'burp.upstreamPort': '3200' })
    expect(readBurpSettings(s)).toEqual({ caPath: 'C:/ca.cer', proxyPort: 8081, upstreamPort: 3200 })
  })

  it('falls back to the default when a stored port is unparseable or out of range', () => {
    const s = fakeStore({ 'burp.proxyPort': 'not-a-number', 'burp.upstreamPort': '0' })
    const r = readBurpSettings(s)
    expect(r.proxyPort).toBe(CAPTURE_DEFAULTS.proxyPort)
    expect(r.upstreamPort).toBe(CAPTURE_DEFAULTS.upstreamPort)
  })
})

describe('writeBurpSettings', () => {
  it('patches only the provided keys and returns the merged result', () => {
    const s = fakeStore({ 'burp.caPath': 'C:/ca.cer' })
    const r = writeBurpSettings(s, { proxyPort: 9090 })
    expect(r).toEqual({ caPath: 'C:/ca.cer', proxyPort: 9090, upstreamPort: CAPTURE_DEFAULTS.upstreamPort })
    expect(s.all()['burp.proxyPort']).toBe('9090')
  })

  it('rejects an invalid port instead of persisting it', () => {
    const s = fakeStore()
    expect(() => writeBurpSettings(s, { proxyPort: 0 })).toThrow(/port/i)
    expect(s.all()['burp.proxyPort']).toBeUndefined()
  })

  it('trims the CA path', () => {
    const s = fakeStore()
    expect(writeBurpSettings(s, { caPath: '  C:/x.cer  ' }).caPath).toBe('C:/x.cer')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/capture/settings.test.ts`
Expected: FAIL — cannot resolve `src/main/capture/settings` / `src/shared/capture`.

- [ ] **Step 3: Write the shared types**

Create `src/shared/capture.ts`:

```typescript
/** Default ports for the Burp capture path. See the design doc for why each hop exists. */
export const CAPTURE_DEFAULTS = {
  /** Burp's proxy listener on host loopback. */
  proxyPort: 8080,
  /** Host port Burp uses as its upstream proxy; held open by `ssh -L`. */
  upstreamPort: 3128,
  /** In-sandbox loopback relay -> gateway.docker.internal:3128. */
  relayPort: 3129,
  /** In-sandbox port applications actually talk to (http_proxy points here). */
  appPort: 18080
} as const

/**
 * Candidate ports tried in order when the preferred one is occupied. Nothing outside the
 * sandbox references these two, so they are chosen dynamically rather than configured:
 * the profile script reads the chosen app port from /tmp/burp-proxy-port.
 */
export const RELAY_PORT_CANDIDATES: readonly number[] = [3129, 3130, 3131, 3132, 3133, 3134, 3135, 3136]
export const APP_PORT_CANDIDATES: readonly number[] = [18080, 18081, 18082, 18083, 18084, 18085, 18086, 18087]

/** Where the chosen app port is published inside the sandbox for /etc/profile.d to read. */
export const PORT_FILE = '/tmp/burp-proxy-port'

/** Host-configurable Burp settings. The two in-sandbox ports are deliberately not here. */
export interface BurpSettings {
  /** Absolute path to the Burp CA file (DER or PEM). Empty means unconfigured. */
  caPath: string
  proxyPort: number
  upstreamPort: number
}

export type CapturePhase = 'preflight' | 'ca' | 'profile' | 'tunnel' | 'verify'
export type CaptureState = 'off' | 'starting' | 'on' | 'error'

/** One named verification result, rendered as a tick or cross in the capture card. */
export interface CaptureCheck {
  id: string
  ok: boolean
  detail: string
}

export interface CapturePorts {
  proxy: number
  upstream: number
  relay: number
  app: number
}

/**
 * Global capture status — global rather than per-instance because only one session can
 * exist. A capture card decides what to render by comparing `sandbox` to its own instance.
 */
export interface CaptureStatus {
  sandbox: string | null
  state: CaptureState
  phase?: CapturePhase
  checks: CaptureCheck[]
  message?: string
  ports?: CapturePorts
}

export const IDLE_STATUS: CaptureStatus = { sandbox: null, state: 'off', checks: [] }
```

- [ ] **Step 4: Write the settings module**

Create `src/main/capture/settings.ts`:

```typescript
import { CAPTURE_DEFAULTS, type BurpSettings } from '@shared/capture'

/** The subset of the app store this module needs — keeps it testable without sqlite. */
export interface PrefStore {
  getPref(key: string): string | null
  setPref(key: string, value: string): void
}

const KEY_CA = 'burp.caPath'
const KEY_PROXY = 'burp.proxyPort'
const KEY_UPSTREAM = 'burp.upstreamPort'

export function isValidPort(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535
}

/** Parse a stored port, falling back to `fallback` when absent, unparseable or out of range. */
function readPort(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const n = Number(raw)
  return isValidPort(n) ? n : fallback
}

export function readBurpSettings(store: PrefStore): BurpSettings {
  return {
    caPath: store.getPref(KEY_CA) ?? '',
    proxyPort: readPort(store.getPref(KEY_PROXY), CAPTURE_DEFAULTS.proxyPort),
    upstreamPort: readPort(store.getPref(KEY_UPSTREAM), CAPTURE_DEFAULTS.upstreamPort)
  }
}

/** Persist only the provided keys; returns the merged settings. Throws on an invalid port. */
export function writeBurpSettings(store: PrefStore, patch: Partial<BurpSettings>): BurpSettings {
  if (patch.proxyPort !== undefined) {
    if (!isValidPort(patch.proxyPort)) throw new Error(`Invalid Burp proxy port: ${String(patch.proxyPort)}`)
    store.setPref(KEY_PROXY, String(patch.proxyPort))
  }
  if (patch.upstreamPort !== undefined) {
    if (!isValidPort(patch.upstreamPort)) throw new Error(`Invalid upstream port: ${String(patch.upstreamPort)}`)
    store.setPref(KEY_UPSTREAM, String(patch.upstreamPort))
  }
  if (patch.caPath !== undefined) store.setPref(KEY_CA, patch.caPath.trim())
  return readBurpSettings(store)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/main/capture/settings.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/shared/capture.ts src/main/capture/settings.ts tests/main/capture/settings.test.ts
git commit -m "feat(capture): shared capture types and Burp settings store"
```

---

### Task 2: Burp upstream-rule config export

**Files:**
- Create: `src/main/capture/burp-config.ts`
- Test: `tests/main/capture/burp-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildBurpUserConfig(upstreamPort: number): string` — pretty-printed JSON, 2-space indent, trailing newline. `BURP_CONFIG_FILENAME: string`.

**Context:** This shape was read from a working Burp installation (`%APPDATA%/BurpSuite/UserConfig.json`). It is **user** options, not project options, so importing it once applies to every Burp project. Do not change the key path.

- [ ] **Step 1: Write the failing test**

Create `tests/main/capture/burp-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildBurpUserConfig, BURP_CONFIG_FILENAME } from '../../../src/main/capture/burp-config'

describe('buildBurpUserConfig', () => {
  it('produces the exact user_options.connections.upstream_proxy shape Burp imports', () => {
    const parsed = JSON.parse(buildBurpUserConfig(3128))
    expect(parsed).toEqual({
      user_options: {
        connections: {
          upstream_proxy: {
            servers: [
              { destination_host: '*', enabled: true, proxy_host: '127.0.0.1', proxy_port: 3128 }
            ]
          }
        }
      }
    })
  })

  it('uses the configured upstream port', () => {
    const parsed = JSON.parse(buildBurpUserConfig(3200))
    expect(parsed.user_options.connections.upstream_proxy.servers[0].proxy_port).toBe(3200)
  })

  it('is pretty-printed with a trailing newline so it reads well in an editor', () => {
    const out = buildBurpUserConfig(3128)
    expect(out).toContain('\n  "user_options"')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('exports a sensible default filename', () => {
    expect(BURP_CONFIG_FILENAME).toBe('burp-upstream-proxy.json')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/capture/burp-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/capture/burp-config.ts`:

```typescript
/** Default filename offered by the Save dialog for the exported Burp config. */
export const BURP_CONFIG_FILENAME = 'burp-upstream-proxy.json'

/**
 * Build the Burp user-config JSON that points Burp's upstream proxy at our `ssh -L` listener.
 *
 * Without this rule Burp goes straight to the internet, bypassing the sbx proxy, and every
 * authenticated request from the sandbox returns 401 — a failure that looks like broken
 * credentials rather than broken proxy config. Exporting it removes the transcription risk
 * of a five-field manual form.
 *
 * The key path (`user_options.connections.upstream_proxy`) was read from a working Burp
 * installation. Being *user* options rather than project options, it is imported once
 * (Settings -> User settings -> Import) and applies to every Burp project.
 */
export function buildBurpUserConfig(upstreamPort: number): string {
  const config = {
    user_options: {
      connections: {
        upstream_proxy: {
          servers: [
            { destination_host: '*', enabled: true, proxy_host: '127.0.0.1', proxy_port: upstreamPort }
          ]
        }
      }
    }
  }
  return `${JSON.stringify(config, null, 2)}\n`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/capture/burp-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/capture/burp-config.ts tests/main/capture/burp-config.test.ts
git commit -m "feat(capture): export Burp upstream-proxy user config"
```

---

### Task 3: Burp CA reading and PEM conversion

**Files:**
- Create: `src/main/capture/ca.ts`
- Test: `tests/main/capture/ca.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface CaInfo { pem: string; subject: string; commonName: string; expires: string }`
  - `parseCaBuffer(buf: Buffer): CaInfo` — throws `Error` with a readable message on non-certificate input.
  - `readCaFile(path: string, readFile?: (p: string) => Buffer): CaInfo`

**Context:** Node's `X509Certificate` accepts **both** DER and PEM and re-emits PEM via `toString()`, which is why this feature has no `openssl` dependency. `cert.subject` is newline-separated (`C=XX\nO=…\nCN=…`), so the common name must be parsed out of it.

- [ ] **Step 1: Write the failing test**

Create `tests/main/capture/ca.test.ts`. The fixture below is a throwaway self-signed certificate generated solely for this test — it is not a real CA and holds no private key:

```typescript
import { describe, it, expect } from 'vitest'
import { X509Certificate } from 'node:crypto'
import { parseCaBuffer, readCaFile } from '../../../src/main/capture/ca'

const FIXTURE_PEM = `-----BEGIN CERTIFICATE-----
MIIDkTCCAnmgAwIBAgIUVt29zzF/rVn8kF/GlOAp9K350lswDQYJKoZIhvcNAQEL
BQAwWDELMAkGA1UEBhMCWFgxFTATBgNVBAoMDFRlc3QgRml4dHVyZTEYMBYGA1UE
CwwPVGVzdCBGaXh0dXJlIENBMRgwFgYDVQQDDA9UZXN0IEZpeHR1cmUgQ0EwHhcN
MjYwODI0MDgyOTI3WhcNMzYwODIxMDgyOTI3WjBYMQswCQYDVQQGEwJYWDEVMBMG
A1UECgwMVGVzdCBGaXh0dXJlMRgwFgYDVQQLDA9UZXN0IEZpeHR1cmUgQ0ExGDAW
BgNVBAMMD1Rlc3QgRml4dHVyZSBDQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC
AQoCggEBALcvX42grAZLoDaIF8ue+6piLMeDCPxKTXv08wNHUZrKzj1SFfvkA1LL
oQXtLxDknaZTXReQJmgFvvWXUkpSNdFS+vGM57MKJE+x9nmnJCc3c4LcDSRDA4Za
teP1vJv/Hu+Nsyt7/8EHiVe0TRD8Ey5GbUHt1iF8i/7LQ1p/T3O43x3eRLM6+syG
ypi0aZHL3E/1EWRWOWkKYybk6HmugeTAUCWEYGlk83cjYVtO3CGx01CX8gESQ6Ep
UwYQNWHaoiUL1Tuu6/ABERAX2cfABHEAOAnp8OqwVeoNBQUyROwSngB1WZO7bwsE
fhEXjcaapEltknooJE8sph8/RZOIo68CAwEAAaNTMFEwHQYDVR0OBBYEFCVMC2gZ
zeUFX/aQNo4SQ+R6UPAuMB8GA1UdIwQYMBaAFCVMC2gZzeUFX/aQNo4SQ+R6UPAu
MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAJXAuNS9CLdnhPPZ
xcA5Chp2JDE2B7MVYjeS/BPv1ogUSSFy98FHcXs3AkMkaYGcpu1XJETmgmOrc4Bq
PsX6RUkocSBF4m4nlTipmE8254jU25/xdUe4vpGQzJpqY1gZc+Kl8b8ZNVYMRSgn
i1huO8kC8/YvM0QD93lzVayJ5Ox1Fpo7hDaXYJX9fPfZVT0s3l/xhio4LgmuQz2Q
pfd4dtQgHnLVtLEEJBOcXvERZtQfPyc9Wo5BXsfEq2PS4I+9IkP3A8/R7ntmOXwP
dn4emNm03uPYvsv16rdLiObHpRAVOQRmxDPSPxB94XzxoG+p79B55lObqGTRXNht
tYUJ2cI=
-----END CERTIFICATE-----
`

/** The same certificate in DER form, derived from the PEM so there is one source of truth. */
const FIXTURE_DER = Buffer.from(new X509Certificate(FIXTURE_PEM).raw)

describe('parseCaBuffer', () => {
  it('parses a PEM certificate', () => {
    const info = parseCaBuffer(Buffer.from(FIXTURE_PEM))
    expect(info.commonName).toBe('Test Fixture CA')
    expect(info.pem).toContain('-----BEGIN CERTIFICATE-----')
    expect(info.expires).toContain('2036')
  })

  it('parses a DER certificate and re-emits it as PEM (no openssl needed)', () => {
    const info = parseCaBuffer(FIXTURE_DER)
    expect(info.commonName).toBe('Test Fixture CA')
    expect(info.pem.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true)
  })

  it('produces identical PEM from DER and PEM inputs', () => {
    expect(parseCaBuffer(FIXTURE_DER).pem).toBe(parseCaBuffer(Buffer.from(FIXTURE_PEM)).pem)
  })

  it('throws a readable error on non-certificate input', () => {
    expect(() => parseCaBuffer(Buffer.from('this is not a certificate'))).toThrow(/not a valid certificate/i)
  })

  it('throws on an empty buffer', () => {
    expect(() => parseCaBuffer(Buffer.alloc(0))).toThrow(/not a valid certificate/i)
  })
})

describe('readCaFile', () => {
  it('reads and parses via the injected reader', () => {
    const info = readCaFile('C:/burp.cer', () => Buffer.from(FIXTURE_PEM))
    expect(info.commonName).toBe('Test Fixture CA')
  })

  it('reports the path when the file cannot be read', () => {
    expect(() => readCaFile('C:/missing.cer', () => { throw new Error('ENOENT') }))
      .toThrow(/C:\/missing\.cer/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/capture/ca.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/capture/ca.ts`:

```typescript
import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface CaInfo {
  /** The certificate in PEM form, ready to embed in the in-sandbox install script. */
  pem: string
  /** Full subject, newline-separated as Node reports it. */
  subject: string
  /** Just the CN, for the settings card's confirmation line. */
  commonName: string
  /** Human-readable expiry, e.g. "Aug 21 08:29:27 2036 GMT". */
  expires: string
}

/** Pull CN out of Node's newline-separated subject string; falls back to the whole subject. */
function commonNameOf(subject: string): string {
  for (const line of subject.split('\n')) {
    const t = line.trim()
    if (t.startsWith('CN=')) return t.slice(3)
  }
  return subject.trim()
}

/**
 * Parse a Burp CA from raw bytes. Node's X509Certificate accepts DER and PEM alike and
 * re-emits PEM, which is why this feature needs no `openssl` binary on the host.
 */
export function parseCaBuffer(buf: Buffer): CaInfo {
  let cert: X509Certificate
  try {
    cert = new X509Certificate(buf)
  } catch {
    throw new Error('That file is not a valid certificate. Export the Burp CA from Proxy > Proxy settings > Import / export CA certificate.')
  }
  return {
    pem: cert.toString(),
    subject: cert.subject,
    commonName: commonNameOf(cert.subject),
    expires: cert.validTo
  }
}

/** Read and parse a CA file. Read failures name the path so the settings card can show it. */
export function readCaFile(path: string, readFile: (p: string) => Buffer = readFileSync): CaInfo {
  let buf: Buffer
  try {
    buf = readFile(path)
  } catch (e) {
    throw new Error(`Could not read the CA file at ${path}: ${(e as Error).message}`)
  }
  return parseCaBuffer(buf)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/capture/ca.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/capture/ca.ts tests/main/capture/ca.test.ts
git commit -m "feat(capture): read Burp CA from DER or PEM without openssl"
```

---

### Task 4: In-sandbox script builders

**Files:**
- Create: `src/main/capture/scripts.ts`
- Test: `tests/main/capture/scripts.test.ts`

**Interfaces:**
- Consumes: `PORT_FILE` from `@shared/capture`.
- Produces:
  - `socatProbeScript(): string`
  - `freePortScript(candidates: readonly number[]): string`
  - `parseFreePort(stdout: string): number | null`
  - `caInstallScript(pem: string): string`
  - `profileScriptBody(): string`
  - `profileInstallScript(): string`
  - `relayCommand(p: { relayPort: number; appPort: number; proxyPort: number }): string`
  - `publishPortScript(appPort: number): string`
  - `teardownScript(p: { relayPort: number; appPort: number }): string`
  - `CA_OK_MARK`, `PROFILE_OK_MARK`, `SOCAT_OK_MARK`, `FREE_PORT_MARK` string constants

**Context:** These run via `sbx exec <name> bash -lc <script>`. `sudo -n` is available in the sandbox and `socat` lives at `/usr/bin/socat` — both verified. The CA PEM is embedded in a quoted heredoc rather than piped, because `execScript` has no stdin channel.

- [ ] **Step 1: Write the failing test**

Create `tests/main/capture/scripts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  socatProbeScript, freePortScript, parseFreePort, caInstallScript, profileScriptBody,
  profileInstallScript, relayCommand, publishPortScript, teardownScript,
  CA_OK_MARK, PROFILE_OK_MARK, SOCAT_OK_MARK, FREE_PORT_MARK
} from '../../../src/main/capture/scripts'
import { PORT_FILE } from '../../../src/shared/capture'

describe('socatProbeScript', () => {
  it('emits the ok marker only when socat resolves', () => {
    const s = socatProbeScript()
    expect(s).toContain('command -v socat')
    expect(s).toContain(SOCAT_OK_MARK)
  })
})

describe('freePortScript / parseFreePort', () => {
  it('checks each candidate for a LISTEN socket and prints the first free one', () => {
    const s = freePortScript([3129, 3130])
    // 3129 = 0x0C39, 3130 = 0x0C3A — /proc/net/tcp renders ports in uppercase hex.
    expect(s).toContain('0C39')
    expect(s).toContain('0C3A')
    expect(s).toContain(FREE_PORT_MARK)
    // Only state 0A (LISTEN) counts; TIME_WAIT sockets must not mark a port as busy.
    expect(s).toContain('0A')
  })

  it('parses the marked port and returns null when none was free', () => {
    expect(parseFreePort(`${FREE_PORT_MARK} 3131\n`)).toBe(3131)
    expect(parseFreePort('noise\n')).toBe(null)
    expect(parseFreePort('')).toBe(null)
  })
})

describe('caInstallScript', () => {
  it('writes the PEM to the trust store and refreshes it', () => {
    const s = caInstallScript('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n')
    expect(s).toContain('/usr/local/share/ca-certificates/burp.crt')
    expect(s).toContain('update-ca-certificates')
    expect(s).toContain('-----BEGIN CERTIFICATE-----')
    expect(s).toContain(CA_OK_MARK)
  })

  it('uses a quoted heredoc so the PEM is never shell-expanded', () => {
    expect(caInstallScript('x')).toContain("<<'BURP_CA_EOF'")
  })

  it('refuses a PEM containing the heredoc delimiter', () => {
    expect(() => caInstallScript('BURP_CA_EOF')).toThrow(/delimiter/i)
  })
})

describe('profileScriptBody', () => {
  it('activates only on a LISTEN socket, never on TIME_WAIT', () => {
    const body = profileScriptBody()
    expect(body).toContain(PORT_FILE)
    expect(body).toContain('$4=="0A"')
    expect(body).toContain('/proc/net/tcp')
  })

  it('exports the proxy variables and keeps loopback direct', () => {
    const body = profileScriptBody()
    for (const v of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY', 'JAVA_TOOL_OPTIONS']) {
      expect(body).toContain(v)
    }
    expect(body).toContain('gateway.docker.internal')
  })

  it('stays POSIX sh — no bashisms, because /bin/sh here is dash', () => {
    const body = profileScriptBody()
    expect(body).not.toContain('/dev/tcp')
    expect(body).not.toContain('[[')
  })
})

describe('profileInstallScript', () => {
  it('writes the profile drop-in via sudo and marks success', () => {
    const s = profileInstallScript()
    expect(s).toContain('/etc/profile.d/burp-proxy.sh')
    expect(s).toContain('sudo tee')
    expect(s).toContain(PROFILE_OK_MARK)
  })
})

describe('relayCommand', () => {
  it('starts both relays and waits, so killing ssh kills them', () => {
    const cmd = relayCommand({ relayPort: 3129, appPort: 18080, proxyPort: 8080 })
    expect(cmd).toContain('TCP4-LISTEN:3129')
    expect(cmd).toContain('TCP6:gateway.docker.internal:3128')
    expect(cmd).toContain('TCP4-LISTEN:18080')
    expect(cmd).toContain('PROXY:gateway.docker.internal:127.0.0.1:8080')
    expect(cmd).toContain('proxyport=3128')
    expect(cmd).toContain('wait')
  })

  it('binds relays to loopback only', () => {
    const cmd = relayCommand({ relayPort: 3129, appPort: 18080, proxyPort: 8080 })
    expect(cmd.match(/bind=127\.0\.0\.1/g)?.length).toBe(2)
  })
})

describe('publishPortScript', () => {
  it('writes the chosen app port where the profile script reads it', () => {
    expect(publishPortScript(18081)).toContain(`echo 18081 > ${PORT_FILE}`)
  })
})

describe('teardownScript', () => {
  it('kills both relays and removes the port file so shells fall back to the sbx proxy', () => {
    const s = teardownScript({ relayPort: 3129, appPort: 18080 })
    expect(s).toContain('TCP4-LISTEN:3129')
    expect(s).toContain('TCP4-LISTEN:18080')
    expect(s).toContain(`rm -f ${PORT_FILE}`)
    expect(s).toContain('exit 0') // teardown must never fail the exec
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/capture/scripts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/capture/scripts.ts`:

```typescript
import { PORT_FILE } from '@shared/capture'

/**
 * Scripts run inside a running sandbox via `sbx exec <name> bash -lc <script>`.
 * `sudo -n` and `/usr/bin/socat` are both present in the sbx base image.
 */

export const SOCAT_OK_MARK = '__SBX_SOCAT_OK__'
export const CA_OK_MARK = '__SBX_CA_OK__'
export const PROFILE_OK_MARK = '__SBX_PROFILE_OK__'
export const FREE_PORT_MARK = '__SBX_FREE_PORT__'

const CA_PATH = '/usr/local/share/ca-certificates/burp.crt'
const PROFILE_PATH = '/etc/profile.d/burp-proxy.sh'
const HEREDOC = 'BURP_CA_EOF'

/** Print the ok marker when socat is installed. */
export function socatProbeScript(): string {
  return `command -v socat >/dev/null 2>&1 && echo ${SOCAT_OK_MARK} || true`
}

/** /proc/net/tcp renders ports as uppercase 4-digit hex. */
function hexPort(port: number): string {
  return port.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Print `FREE_PORT_MARK <port>` for the first candidate with no LISTEN socket.
 *
 * State `0A` is LISTEN. Matching any looser also matches `TIME_WAIT` (state `06`) sockets,
 * of which there are many on a recently-used capture port, and would report a free port as
 * busy — the mirror image of the bug the profile script guards against.
 */
export function freePortScript(candidates: readonly number[]): string {
  const checks = candidates.map((p) => {
    const h = hexPort(p)
    return `if ! awk '$4=="0A" && $2 ~ /:${h}$/ {found=1} END{exit !found}' /proc/net/tcp 2>/dev/null; then echo "${FREE_PORT_MARK} ${p}"; exit 0; fi`
  })
  return checks.join('\n')
}

export function parseFreePort(stdout: string): number | null {
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(new RegExp(`^${FREE_PORT_MARK}\\s+(\\d+)$`))
    if (m) return Number(m[1])
  }
  return null
}

/**
 * Install the Burp CA into the sandbox trust store. `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`
 * and `NODE_EXTRA_CA_CERTS` all point at /etc/ssl/certs/ca-certificates.crt, so this single
 * install covers curl, openssl, python-requests, node and Claude Code together.
 *
 * The PEM is embedded in a quoted heredoc (never expanded) because `execScript` has no
 * stdin channel. Idempotent — re-run on every enable, since a sandbox rebuild wipes it.
 */
export function caInstallScript(pem: string): string {
  if (pem.includes(HEREDOC)) throw new Error('Certificate content contains the heredoc delimiter; refusing to build an ambiguous script.')
  return [
    `sudo tee ${CA_PATH} >/dev/null <<'${HEREDOC}'`,
    pem.trimEnd(),
    HEREDOC,
    `sudo update-ca-certificates >/dev/null 2>&1 && echo ${CA_OK_MARK}`
  ].join('\n')
}

/**
 * Body of /etc/profile.d/burp-proxy.sh.
 *
 * Must stay POSIX sh: /bin/sh here is dash, which has no `/dev/tcp`. Liveness is therefore
 * read from /proc/net/tcp, and the state comparison is exact: `0A` is LISTEN, and matching
 * anything looser also matches TIME_WAIT sockets — measured at 20 of them on the capture
 * port immediately after a teardown. A false pass there would keep exporting http_proxy to
 * a dead relay and break egress, instead of falling back to the sbx proxy.
 */
export function profileScriptBody(): string {
  return `# ${PROFILE_PATH}
# Point login shells at Burp, but only while the tunnel is genuinely up, so closing Burp
# degrades to the stock sbx proxy instead of killing egress.
# Must stay POSIX sh: /bin/sh here is dash, which has no bash-style TCP device redirection.
# (Do not write the literal device path here — the test asserts the emitted body omits it.)

_bp_file=${PORT_FILE}
if [ -r "$_bp_file" ]; then
    _bp_port=$(cat "$_bp_file" 2>/dev/null)
    case "$_bp_port" in
        ''|*[!0-9]*) _bp_port="" ;;
    esac
fi

if [ -n "\${_bp_port:-}" ]; then
    # Read-only liveness check. State 0A is LISTEN; matching anything looser also matches
    # TIME_WAIT sockets on the same port and gives a false pass.
    _bp_hex=$(printf '%04X' "$_bp_port")
    if awk -v h=":$_bp_hex" '$4=="0A" && index($2,h) {found=1} END{exit !found}' \\
         /proc/net/tcp 2>/dev/null; then

        http_proxy="http://127.0.0.1:$_bp_port";  export http_proxy
        https_proxy="$http_proxy";                export https_proxy
        HTTP_PROXY="$http_proxy";                 export HTTP_PROXY
        HTTPS_PROXY="$http_proxy";                export HTTPS_PROXY

        JAVA_TOOL_OPTIONS="-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=$_bp_port -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=$_bp_port -Dhttp.nonProxyHosts=localhost|127.*|[::1]|gateway.docker.internal"
        export JAVA_TOOL_OPTIONS

        # no_proxy is matched against the DESTINATION, never the proxy address, so keeping
        # loopback here leaves sandbox-local services direct without bypassing the tunnel.
        no_proxy="localhost,127.0.0.1,::1,gateway.docker.internal"; export no_proxy
        NO_PROXY="$no_proxy"; export NO_PROXY
    fi
fi
unset _bp_file _bp_port _bp_hex
`
}

/** Write the profile drop-in via sudo. Quoted heredoc: the body must reach disk verbatim. */
export function profileInstallScript(): string {
  return [
    `sudo tee ${PROFILE_PATH} >/dev/null <<'BURP_PROFILE_EOF'`,
    profileScriptBody().trimEnd(),
    'BURP_PROFILE_EOF',
    `sudo chmod 0644 ${PROFILE_PATH} && echo ${PROFILE_OK_MARK}`
  ].join('\n')
}

/**
 * The remote command carried by the ssh session. Both relays run under it and the trailing
 * `wait` keeps the session alive, so killing the ssh child tears the whole apparatus down.
 *
 * - `:relayPort` is the loopback hop `ssh -L` needs, because sbx's SSH server permits
 *   loopback forwarding only and cannot target gateway.docker.internal directly.
 * - `:appPort` is what http_proxy points at. It reaches Burp by asking the sbx proxy to
 *   CONNECT to 127.0.0.1:<proxyPort> — sandboxd is a host process, so that loopback is the
 *   host's. This is the only route: no host alias is reachable from inside the sandbox.
 */
export function relayCommand(p: { relayPort: number; appPort: number; proxyPort: number }): string {
  const relay = `socat TCP4-LISTEN:${p.relayPort},bind=127.0.0.1,fork,reuseaddr TCP6:gateway.docker.internal:3128`
  const app = `socat TCP4-LISTEN:${p.appPort},bind=127.0.0.1,fork,reuseaddr PROXY:gateway.docker.internal:127.0.0.1:${p.proxyPort},proxyport=3128,pf=ip6`
  return `${relay} & ${app} & wait`
}

/** Publish the chosen app port where /etc/profile.d reads it. */
export function publishPortScript(appPort: number): string {
  return `echo ${appPort} > ${PORT_FILE}`
}

/**
 * Belt-and-braces teardown. Killing the ssh child normally takes the relays with it, but
 * sbx's SSH server is a custom Go implementation whose signal propagation is not guaranteed.
 * Removing the port file is what makes new shells fall back to the stock sbx proxy.
 * Always exits 0 — a teardown that throws would strand the session in a wedged state.
 *
 * The `[ ]` in the pattern is a self-match guard: the `bash -lc` parent carries this whole
 * script in its own cmdline, and a plain `-f` pattern would match it and kill the exec that
 * is doing the teardown. `socat[ ]TCP4-LISTEN:<port>` matches the real relay (`socat` then a
 * space) but not this script's own text (`socat` then `[`). Do not "simplify" the brackets.
 */
export function teardownScript(p: { relayPort: number; appPort: number }): string {
  return [
    `pkill -f 'socat[ ]TCP4-LISTEN:${p.relayPort}' >/dev/null 2>&1`,
    `pkill -f 'socat[ ]TCP4-LISTEN:${p.appPort}' >/dev/null 2>&1`,
    `rm -f ${PORT_FILE}`,
    'exit 0'
  ].join('; ')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/capture/scripts.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/capture/scripts.ts tests/main/capture/scripts.test.ts
git commit -m "feat(capture): in-sandbox script builders for relays, CA and profile"
```

---

### Task 5: Verification — host TCP probe and in-sandbox verify parser

**Files:**
- Create: `src/main/capture/verify.ts`
- Test: `tests/main/capture/verify.test.ts`

**Interfaces:**
- Consumes: `CaptureCheck` from `@shared/capture`.
- Produces:
  - `tcpProbe(port: number, opts?: { host?: string; timeoutMs?: number }): Promise<boolean>`
  - `verifyScript(appPort: number): string`
  - `parseVerify(stdout: string): { concurrency: { ok: number; total: number }; credential: { host: 'anthropic' | 'github' | 'none'; code: number | null } }`
  - `verifyChecks(v: ReturnType<typeof parseVerify>): CaptureCheck[]`
  - `credentialChainOk(v: ReturnType<typeof parseVerify>): boolean`

**Context:** The host-side "upstream chain" curl from the spike is deliberately **not** reimplemented. The in-sandbox request through the app port already traverses the entire path — app port, Burp, `ssh -L`, relay, sbx proxy — so it is strictly stronger, and it avoids needing an HTTP-proxy-capable client on the host (Node's `fetch` has no proxy support). The host only needs to know the `-L` listener is bound, which is a TCP connect.

Credential probe order: Anthropic first (`GET /v1/models` — always applicable here, no request body, spends no tokens), GitHub as fallback, then neither. A non-`401` `4xx` still proves the chain works, because authentication precedes request validation.

- [ ] **Step 1: Write the failing test**

Create `tests/main/capture/verify.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:net'
import { tcpProbe, verifyScript, parseVerify, verifyChecks, credentialChainOk } from '../../../src/main/capture/verify'

let server: Server | null = null
afterEach(() => { server?.close(); server = null })

function listen(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer()
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port))
  })
}

describe('tcpProbe', () => {
  it('resolves true for a bound port', async () => {
    const port = await listen()
    expect(await tcpProbe(port)).toBe(true)
  })

  it('resolves false for an unbound port', async () => {
    const port = await listen()
    await new Promise<void>((r) => server!.close(() => r()))
    server = null
    expect(await tcpProbe(port, { timeoutMs: 500 })).toBe(false)
  })

  it('never rejects', async () => {
    await expect(tcpProbe(1, { timeoutMs: 200 })).resolves.toBe(false)
  })
})

describe('verifyScript', () => {
  it('runs 12 concurrent requests through the app port', () => {
    const s = verifyScript(18080)
    expect(s).toContain('http://127.0.0.1:18080')
    expect(s).toContain('seq 1 12')
    expect(s).toContain('CONC=')
  })

  it('probes Anthropic first and falls back to GitHub', () => {
    const s = verifyScript(18080)
    expect(s).toContain('api.anthropic.com/v1/models')
    expect(s).toContain('api.github.com/user')
    expect(s).toContain('CRED=')
    expect(s).toContain('CREDHOST=')
  })
})

describe('parseVerify', () => {
  it('parses a healthy run', () => {
    const v = parseVerify('CONC=12/12\nCRED=200\nCREDHOST=anthropic\n')
    expect(v.concurrency).toEqual({ ok: 12, total: 12 })
    expect(v.credential).toEqual({ host: 'anthropic', code: 200 })
  })

  it('parses a partial concurrency failure', () => {
    expect(parseVerify('CONC=4/12\nCRED=200\nCREDHOST=github\n').concurrency).toEqual({ ok: 4, total: 12 })
  })

  it('parses the no-credential case', () => {
    expect(parseVerify('CONC=12/12\nCRED=\nCREDHOST=none\n').credential).toEqual({ host: 'none', code: null })
  })

  it('tolerates malformed or empty output', () => {
    const v = parseVerify('garbage')
    expect(v.concurrency).toEqual({ ok: 0, total: 12 })
    expect(v.credential).toEqual({ host: 'none', code: null })
    expect(parseVerify('').concurrency.ok).toBe(0)
  })
})

describe('credentialChainOk', () => {
  it('passes on 200', () => {
    expect(credentialChainOk(parseVerify('CONC=12/12\nCRED=200\nCREDHOST=anthropic\n'))).toBe(true)
  })

  it('passes on a non-401 4xx, since auth precedes request validation', () => {
    expect(credentialChainOk(parseVerify('CONC=12/12\nCRED=404\nCREDHOST=anthropic\n'))).toBe(true)
  })

  it('fails on 401 — that is Burp going direct instead of chaining', () => {
    expect(credentialChainOk(parseVerify('CONC=12/12\nCRED=401\nCREDHOST=anthropic\n'))).toBe(false)
  })

  it('is not a failure when no credential is configured to probe with', () => {
    expect(credentialChainOk(parseVerify('CONC=12/12\nCRED=\nCREDHOST=none\n'))).toBe(true)
  })
})

describe('verifyChecks', () => {
  it('reports concurrency and credential checks', () => {
    const checks = verifyChecks(parseVerify('CONC=12/12\nCRED=200\nCREDHOST=anthropic\n'))
    expect(checks.find((c) => c.id === 'concurrency')).toMatchObject({ ok: true, detail: '12/12' })
    expect(checks.find((c) => c.id === 'credential')).toMatchObject({ ok: true })
  })

  it('marks concurrency failed when not all requests succeeded', () => {
    const checks = verifyChecks(parseVerify('CONC=4/12\nCRED=200\nCREDHOST=github\n'))
    expect(checks.find((c) => c.id === 'concurrency')?.ok).toBe(false)
  })

  it('marks the credential check unverified rather than passed when nothing was probed', () => {
    const c = verifyChecks(parseVerify('CONC=12/12\nCRED=\nCREDHOST=none\n')).find((x) => x.id === 'credential')
    expect(c?.ok).toBe(false)
    expect(c?.detail).toMatch(/not verified/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/capture/verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/capture/verify.ts`:

```typescript
import { connect } from 'node:net'
import type { CaptureCheck } from '@shared/capture'

/** Number of parallel requests in the concurrency check. */
const CONCURRENCY = 12

/**
 * Is something listening on a host loopback port? Used twice: Burp during preflight, and
 * the `ssh -L` listener after the tunnel phase. Never rejects — a probe failure is a
 * `false`, not an exception.
 */
export function tcpProbe(port: number, opts: { host?: string; timeoutMs?: number } = {}): Promise<boolean> {
  const { host = '127.0.0.1', timeoutMs = 2000 } = opts
  return new Promise((resolve) => {
    let settled = false
    const done = (result: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    const socket = connect({ port, host })
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

/**
 * In-sandbox verification. This single script exercises the entire chain — app port, Burp,
 * `ssh -L`, relay, sbx proxy — so no separate host-side chain check is needed.
 *
 * The credential probe uses Anthropic's `GET /v1/models` first: it is the agent's own API,
 * configured in every sandbox this app targets, needs no request body, and spends no tokens.
 * GitHub is the fallback for sandboxes without an Anthropic credential.
 */
export function verifyScript(appPort: number): string {
  const proxy = `http://127.0.0.1:${appPort}`
  return `
P=${proxy}
OK=$(for i in $(seq 1 ${CONCURRENCY}); do (timeout 25 curl -s -o /dev/null -w '%{http_code}\\n' -x "$P" https://example.com 2>/dev/null) & done; wait)
echo "CONC=$(echo "$OK" | grep -c '^200$')/${CONCURRENCY}"
if [ -n "\${ANTHROPIC_API_KEY:-}" ] || [ "\${SBX_CRED_ANTHROPIC_MODE:-none}" != "unavailable" ]; then
  C=$(timeout 25 curl -s -o /dev/null -w '%{http_code}' -x "$P" -H 'anthropic-version: 2023-06-01' https://api.anthropic.com/v1/models 2>/dev/null)
  if [ -n "$C" ] && [ "$C" != "000" ]; then echo "CRED=$C"; echo "CREDHOST=anthropic"; exit 0; fi
fi
if [ -n "\${GH_TOKEN:-}" ]; then
  C=$(timeout 25 curl -s -o /dev/null -w '%{http_code}' -x "$P" -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user 2>/dev/null)
  if [ -n "$C" ] && [ "$C" != "000" ]; then echo "CRED=$C"; echo "CREDHOST=github"; exit 0; fi
fi
echo "CRED="
echo "CREDHOST=none"
`.trim()
}

export interface VerifyResult {
  concurrency: { ok: number; total: number }
  credential: { host: 'anthropic' | 'github' | 'none'; code: number | null }
}

function matchLine(stdout: string, key: string): string | null {
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (t.startsWith(`${key}=`)) return t.slice(key.length + 1)
  }
  return null
}

/** Parse the verify script's marker lines. Tolerates empty and malformed output. */
export function parseVerify(stdout: string): VerifyResult {
  const conc = matchLine(stdout, 'CONC')
  const m = conc?.match(/^(\d+)\/(\d+)$/)
  const hostRaw = matchLine(stdout, 'CREDHOST')
  const host = hostRaw === 'anthropic' || hostRaw === 'github' ? hostRaw : 'none'
  const codeRaw = matchLine(stdout, 'CRED')
  const code = codeRaw && /^\d+$/.test(codeRaw) ? Number(codeRaw) : null
  return {
    concurrency: { ok: m ? Number(m[1]) : 0, total: m ? Number(m[2]) : CONCURRENCY },
    credential: { host, code }
  }
}

/**
 * Whether the Burp-chains-back-into-the-sbx-proxy requirement holds.
 *
 * Only `401` indicates a broken chain: authentication happens at the sbx proxy before the
 * upstream service validates the request, so any other 4xx still proves injection worked.
 * When nothing could be probed this is not treated as a failure — the card warns instead.
 */
export function credentialChainOk(v: VerifyResult): boolean {
  if (v.credential.host === 'none' || v.credential.code === null) return true
  return v.credential.code !== 401
}

export function verifyChecks(v: VerifyResult): CaptureCheck[] {
  const concOk = v.concurrency.total > 0 && v.concurrency.ok === v.concurrency.total
  const credChecked = v.credential.host !== 'none' && v.credential.code !== null
  return [
    { id: 'concurrency', ok: concOk, detail: `${v.concurrency.ok}/${v.concurrency.total}` },
    {
      id: 'credential',
      ok: credChecked && credentialChainOk(v),
      detail: credChecked
        ? `${v.credential.host} ${v.credential.code}`
        : 'not verified — no credential to probe with'
    }
  ]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/capture/verify.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/capture/verify.ts tests/main/capture/verify.test.ts
git commit -m "feat(capture): host TCP probe and in-sandbox verification parser"
```

---

### Task 6: Capture session manager

**Files:**
- Create: `src/main/capture/session.ts`
- Test: `tests/main/capture/session.test.ts`

**Interfaces:**
- Consumes: `readBurpSettings` (Task 1), `readCaFile`/`CaInfo` (Task 3), all script builders (Task 4), `tcpProbe`/`verifyScript`/`parseVerify`/`verifyChecks`/`credentialChainOk` (Task 5).
- Produces:
  - `interface CaptureChild { kill(): void; onExit(cb: () => void): void }`
  - `interface CaptureDeps { exec, execCapture, settings, readCa, spawnSsh, probe, log? }`
  - `interface CaptureSession { status(): CaptureStatus; enable(sandbox: string, opts?: { force?: boolean }): Promise<CaptureStatus>; disable(): Promise<CaptureStatus>; onRunningInstances(names: string[]): void }`
  - `createCaptureSession(deps: CaptureDeps): CaptureSession`
  - `sshArgs(p: { sandbox: string; upstreamPort: number; relayPort: number; appPort: number; proxyPort: number }): string[]`

- [ ] **Step 1: Write the failing test**

Create `tests/main/capture/session.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createCaptureSession, sshArgs, type CaptureDeps } from '../../../src/main/capture/session'
import { CAPTURE_DEFAULTS } from '../../../src/shared/capture'
import { SOCAT_OK_MARK, CA_OK_MARK, PROFILE_OK_MARK, FREE_PORT_MARK } from '../../../src/main/capture/scripts'

const CA = { pem: '-----BEGIN CERTIFICATE-----\nAA\n-----END CERTIFICATE-----', subject: 'CN=Burp', commonName: 'Burp', expires: '2036' }

/** Default happy-path capture output, keyed by a distinguishing fragment of the script. */
function happyCapture(script: string): string {
  if (script.includes('command -v socat')) return `${SOCAT_OK_MARK}\n`
  // The relay and app probes are the same script shape over different candidate lists, so
  // answer with the first candidate the script itself names rather than a fixed port —
  // otherwise both calls resolve to the relay port and the `app` port assertion fails.
  if (script.includes(FREE_PORT_MARK)) {
    const port = script.includes(`${FREE_PORT_MARK} ${CAPTURE_DEFAULTS.appPort}`)
      ? CAPTURE_DEFAULTS.appPort
      : CAPTURE_DEFAULTS.relayPort
    return `${FREE_PORT_MARK} ${port}\n`
  }
  if (script.includes('update-ca-certificates')) return `${CA_OK_MARK}\n`
  if (script.includes('profile.d')) return `${PROFILE_OK_MARK}\n`
  if (script.includes('CONC=')) return 'CONC=12/12\nCRED=200\nCREDHOST=anthropic\n'
  return ''
}

function deps(over: Partial<CaptureDeps> = {}): CaptureDeps & { killed: () => number; scripts: string[] } {
  const scripts: string[] = []
  let killed = 0
  return {
    exec: vi.fn(async (_n: string, s: string) => { scripts.push(s) }),
    execCapture: vi.fn(async (_n: string, s: string) => { scripts.push(s); return happyCapture(s) }),
    settings: () => ({ caPath: 'C:/burp.cer', proxyPort: 8080, upstreamPort: 3128 }),
    readCa: () => CA,
    spawnSsh: vi.fn(() => ({ kill: () => { killed += 1 }, onExit: () => {} })),
    probe: vi.fn(async () => true),
    ...over,
    killed: () => killed,
    scripts
  } as CaptureDeps & { killed: () => number; scripts: string[] }
}

describe('sshArgs', () => {
  it('forwards the upstream port to the in-sandbox relay and carries the relay command', () => {
    const args = sshArgs({ sandbox: 'demo', upstreamPort: 3128, relayPort: 3129, appPort: 18080, proxyPort: 8080 })
    expect(args).toContain('-L')
    expect(args).toContain('3128:127.0.0.1:3129')
    expect(args).toContain('demo.sbx')
    expect(args.join(' ')).toContain('TCP4-LISTEN:18080')
    expect(args).toContain('ExitOnForwardFailure=yes')
  })
})

describe('capture session', () => {
  it('starts idle', () => {
    expect(createCaptureSession(deps()).status()).toEqual({ sandbox: null, state: 'off', checks: [] })
  })

  it('runs the full happy path and ends on', async () => {
    const d = deps()
    const s = createCaptureSession(d)
    const st = await s.enable('demo')
    expect(st.state).toBe('on')
    expect(st.sandbox).toBe('demo')
    expect(st.ports).toEqual({ proxy: 8080, upstream: 3128, relay: 3129, app: CAPTURE_DEFAULTS.appPort })
    expect(d.spawnSsh).toHaveBeenCalledOnce()
    expect(st.checks.find((c) => c.id === 'credential')?.ok).toBe(true)
  })

  it('installs the CA and the profile drop-in before starting the tunnel', async () => {
    const d = deps()
    await createCaptureSession(d).enable('demo')
    const caAt = d.scripts.findIndex((s) => s.includes('update-ca-certificates'))
    const profileAt = d.scripts.findIndex((s) => s.includes('profile.d'))
    expect(caAt).toBeGreaterThanOrEqual(0)
    expect(profileAt).toBeGreaterThan(caAt)
  })

  it('publishes the chosen app port for the profile script', async () => {
    const d = deps()
    await createCaptureSession(d).enable('demo')
    expect(d.scripts.some((s) => s.includes('/tmp/burp-proxy-port'))).toBe(true)
  })

  it('fails preflight when no CA is configured, without spawning ssh', async () => {
    const d = deps({ settings: () => ({ caPath: '', proxyPort: 8080, upstreamPort: 3128 }) })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('error')
    expect(st.phase).toBe('preflight')
    expect(st.message).toMatch(/certificate/i)
    expect(d.spawnSsh).not.toHaveBeenCalled()
  })

  it('fails preflight when Burp is not listening', async () => {
    const d = deps({ probe: vi.fn(async () => false) })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('error')
    expect(st.phase).toBe('preflight')
    expect(st.message).toMatch(/8080/)
    expect(d.spawnSsh).not.toHaveBeenCalled()
  })

  it('fails preflight when socat is missing from the sandbox', async () => {
    const d = deps({ execCapture: vi.fn(async (_n: string, s: string) => (s.includes('command -v socat') ? '' : happyCapture(s))) })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('error')
    expect(st.message).toMatch(/socat/i)
  })

  it('fails when no candidate port is free, naming the port', async () => {
    const d = deps({ execCapture: vi.fn(async (_n: string, s: string) => (s.includes(FREE_PORT_MARK) ? '' : happyCapture(s))) })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('error')
    expect(st.message).toMatch(/port/i)
  })

  it('tears down and reports when the credential chain is broken (fail closed)', async () => {
    const d = deps({
      execCapture: vi.fn(async (_n: string, s: string) =>
        (s.includes('CONC=') ? 'CONC=12/12\nCRED=401\nCREDHOST=anthropic\n' : happyCapture(s)))
    })
    const s = createCaptureSession(d)
    const st = await s.enable('demo')
    expect(st.state).toBe('error')
    expect(st.phase).toBe('verify')
    expect(d.killed()).toBe(1)
    expect(s.status().state).toBe('error')
  })

  it('enables anyway when forced, despite a broken credential chain', async () => {
    const d = deps({
      execCapture: vi.fn(async (_n: string, s: string) =>
        (s.includes('CONC=') ? 'CONC=12/12\nCRED=401\nCREDHOST=anthropic\n' : happyCapture(s)))
    })
    const st = await createCaptureSession(d).enable('demo', { force: true })
    expect(st.state).toBe('on')
    expect(d.killed()).toBe(0)
  })

  it('does not treat an unverifiable credential chain as a failure', async () => {
    const d = deps({
      execCapture: vi.fn(async (_n: string, s: string) =>
        (s.includes('CONC=') ? 'CONC=12/12\nCRED=\nCREDHOST=none\n' : happyCapture(s)))
    })
    const st = await createCaptureSession(d).enable('demo')
    expect(st.state).toBe('on')
    expect(st.checks.find((c) => c.id === 'credential')?.ok).toBe(false)
  })

  it('refuses a second sandbox while one is capturing, and names the occupant', async () => {
    const s = createCaptureSession(deps())
    await s.enable('first')
    const st = await s.enable('second')
    expect(st.state).toBe('on')
    expect(st.sandbox).toBe('first')
    expect(st.message).toMatch(/first/)
  })

  it('disables: kills the child, runs teardown, returns to idle', async () => {
    const d = deps()
    const s = createCaptureSession(d)
    await s.enable('demo')
    const st = await s.disable()
    expect(st).toEqual({ sandbox: null, state: 'off', checks: [] })
    expect(d.killed()).toBe(1)
    expect(d.scripts.some((x) => x.includes('rm -f /tmp/burp-proxy-port'))).toBe(true)
  })

  it('disable is idempotent and safe when nothing is running', async () => {
    const s = createCaptureSession(deps())
    expect((await s.disable()).state).toBe('off')
    expect((await s.disable()).state).toBe('off')
  })

  it('still returns to idle when the teardown exec throws', async () => {
    const d = deps({ exec: vi.fn(async () => { throw new Error('sandbox gone') }) })
    const s = createCaptureSession(d)
    await s.enable('demo')
    expect((await s.disable()).state).toBe('off')
  })

  it('tears down when its sandbox stops appearing as running', async () => {
    const d = deps()
    const s = createCaptureSession(d)
    await s.enable('demo')
    s.onRunningInstances(['other'])
    await vi.waitFor(() => expect(s.status().state).toBe('off'))
    expect(d.killed()).toBe(1)
  })

  it('keeps capturing while its sandbox is still running', async () => {
    const s = createCaptureSession(deps())
    await s.enable('demo')
    s.onRunningInstances(['demo', 'other'])
    expect(s.status().state).toBe('on')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/capture/session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/capture/session.ts`:

```typescript
import {
  APP_PORT_CANDIDATES, RELAY_PORT_CANDIDATES, IDLE_STATUS,
  type CaptureCheck, type CapturePhase, type CapturePorts, type CaptureStatus
} from '@shared/capture'
import type { BurpSettings } from '@shared/capture'
import type { CaInfo } from './ca'
import {
  socatProbeScript, freePortScript, parseFreePort, caInstallScript, profileInstallScript,
  relayCommand, publishPortScript, teardownScript,
  SOCAT_OK_MARK, CA_OK_MARK, PROFILE_OK_MARK
} from './scripts'
import { verifyScript, parseVerify, verifyChecks, credentialChainOk } from './verify'
import type { Logger } from '../log'

/** The ssh child, narrowed to what the session needs — keeps tests free of real processes. */
export interface CaptureChild {
  kill(): void
  onExit(cb: () => void): void
}

export interface CaptureDeps {
  /** `sbx exec <name> bash -lc <script>`, throwing on non-zero. */
  exec: (sandbox: string, script: string) => Promise<void>
  /** Same, returning stdout. */
  execCapture: (sandbox: string, script: string) => Promise<string>
  settings: () => BurpSettings
  readCa: (path: string) => CaInfo
  spawnSsh: (args: string[]) => CaptureChild
  /** Host loopback TCP probe. */
  probe: (port: number) => Promise<boolean>
  log?: Logger
}

export interface CaptureSession {
  status(): CaptureStatus
  enable(sandbox: string, opts?: { force?: boolean }): Promise<CaptureStatus>
  disable(): Promise<CaptureStatus>
  /** Fed by the reconciler so a stopped sandbox tears its capture down. */
  onRunningInstances(names: string[]): void
}

/**
 * ssh arguments for the one supervised child.
 *
 * `-L <upstream>:127.0.0.1:<relay>` is the only thing `sbx exec` cannot do. The relay
 * command rides along so that killing this child tears the whole apparatus down.
 * `ExitOnForwardFailure` turns a refused forward into an exit rather than a silent no-op.
 */
export function sshArgs(p: {
  sandbox: string; upstreamPort: number; relayPort: number; appPort: number; proxyPort: number
}): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-L', `${p.upstreamPort}:127.0.0.1:${p.relayPort}`,
    `${p.sandbox}.sbx`,
    relayCommand({ relayPort: p.relayPort, appPort: p.appPort, proxyPort: p.proxyPort })
  ]
}

/** Wait for a condition to hold, polling. Used to confirm the -L listener actually bound. */
async function waitFor(check: () => Promise<boolean>, attempts: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return false
}

class CaptureError extends Error {
  constructor(readonly phase: CapturePhase, message: string) {
    super(message)
  }
}

export function createCaptureSession(deps: CaptureDeps): CaptureSession {
  let state: CaptureStatus = { ...IDLE_STATUS }
  let child: CaptureChild | null = null
  let active: { sandbox: string; ports: CapturePorts } | null = null

  function set(next: CaptureStatus): CaptureStatus {
    state = next
    return state
  }

  /** Kill the child and clear the relays. Never throws — teardown must always complete. */
  async function teardown(): Promise<void> {
    const target = active
    child?.kill()
    child = null
    active = null
    if (!target) return
    try {
      await deps.exec(target.sandbox, teardownScript({ relayPort: target.ports.relay, appPort: target.ports.app }))
    } catch (e) {
      // The sandbox may already be gone; the child is dead either way, which is what matters.
      deps.log?.error(`capture teardown exec failed: ${(e as Error).message}`)
    }
  }

  /** Pick the first candidate port with no LISTEN socket inside the sandbox. */
  async function pickPort(sandbox: string, candidates: readonly number[], label: string): Promise<number> {
    const out = await deps.execCapture(sandbox, freePortScript(candidates))
    const port = parseFreePort(out)
    if (port === null) throw new CaptureError('preflight', `No free ${label} port in the sandbox (tried ${candidates.join(', ')}).`)
    return port
  }

  async function runEnable(sandbox: string, force: boolean): Promise<CaptureStatus> {
    const cfg = deps.settings()

    // ---- preflight -------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'preflight', checks: [] })
    if (!cfg.caPath.trim()) {
      throw new CaptureError('preflight', 'No Burp CA certificate configured. Set one in Settings > Traffic capture.')
    }
    const ca = deps.readCa(cfg.caPath)
    if (!(await deps.probe(cfg.proxyPort))) {
      throw new CaptureError('preflight', `Burp is not listening on 127.0.0.1:${cfg.proxyPort}. Start Burp, or correct the port in Settings.`)
    }
    const socatOut = await deps.execCapture(sandbox, socatProbeScript())
    if (!socatOut.includes(SOCAT_OK_MARK)) {
      throw new CaptureError('preflight', 'socat is not installed in this sandbox, so the capture relays cannot run.')
    }
    const relayPort = await pickPort(sandbox, RELAY_PORT_CANDIDATES, 'relay')
    const appPort = await pickPort(sandbox, APP_PORT_CANDIDATES, 'capture')
    const ports: CapturePorts = { proxy: cfg.proxyPort, upstream: cfg.upstreamPort, relay: relayPort, app: appPort }
    const checks: CaptureCheck[] = [{ id: 'burp', ok: true, detail: `127.0.0.1:${cfg.proxyPort}` }]

    // ---- ca --------------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'ca', checks, ports })
    const caOut = await deps.execCapture(sandbox, caInstallScript(ca.pem))
    if (!caOut.includes(CA_OK_MARK)) throw new CaptureError('ca', 'Could not install the Burp CA into the sandbox trust store.')
    checks.push({ id: 'ca', ok: true, detail: ca.commonName })

    // ---- profile ---------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'profile', checks, ports })
    const profOut = await deps.execCapture(sandbox, profileInstallScript())
    if (!profOut.includes(PROFILE_OK_MARK)) throw new CaptureError('profile', 'Could not write /etc/profile.d/burp-proxy.sh in the sandbox.')

    // ---- tunnel ----------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'tunnel', checks, ports })
    child = deps.spawnSsh(sshArgs({ sandbox, upstreamPort: cfg.upstreamPort, relayPort, appPort, proxyPort: cfg.proxyPort }))
    active = { sandbox, ports }
    child.onExit(() => {
      // The tunnel died on its own (Burp closed, sandbox stopped, network blip). Reflect it
      // rather than showing a live session against a dead child.
      if (active?.sandbox === sandbox && state.state === 'on') {
        child = null
        void teardown().then(() => set({ ...IDLE_STATUS }))
      }
    })
    const bound = await waitFor(() => deps.probe(cfg.upstreamPort), 10, 500)
    if (!bound) throw new CaptureError('tunnel', `The SSH tunnel did not bind 127.0.0.1:${cfg.upstreamPort}. Another process may be using that port.`)
    checks.push({ id: 'tunnel', ok: true, detail: `127.0.0.1:${cfg.upstreamPort}` })

    // Publish the chosen port so /etc/profile.d activates for new shells.
    await deps.exec(sandbox, publishPortScript(appPort))

    // ---- verify ----------------------------------------------------------
    set({ sandbox, state: 'starting', phase: 'verify', checks, ports })
    const verdict = parseVerify(await deps.execCapture(sandbox, verifyScript(appPort)))
    const vChecks = [...checks, ...verifyChecks(verdict)]
    if (!force && !credentialChainOk(verdict)) {
      // Fail closed: a capture that silently 401s the agent is worse than no capture.
      await teardown()
      return set({
        sandbox, state: 'error', phase: 'verify', checks: vChecks, ports,
        message: 'Burp is not chaining back into the sbx proxy, so authenticated requests return 401. Import the Burp upstream-proxy config from Settings, then try again.'
      })
    }
    return set({ sandbox, state: 'on', checks: vChecks, ports })
  }

  return {
    status: () => state,

    async enable(sandbox, opts = {}) {
      // One at a time: Burp's single upstream rule points at one port.
      if (active && active.sandbox !== sandbox) {
        return set({ ...state, message: `${active.sandbox} is already being captured. Disable it first.` })
      }
      if (active && active.sandbox === sandbox && state.state === 'on') return state
      try {
        return await runEnable(sandbox, opts.force === true)
      } catch (e) {
        await teardown()
        const err = e as CaptureError
        return set({
          sandbox, state: 'error',
          phase: err.phase ?? 'preflight',
          checks: state.checks,
          message: err.message ?? String(e)
        })
      }
    },

    async disable() {
      await teardown()
      return set({ ...IDLE_STATUS })
    },

    onRunningInstances(names) {
      if (active && !names.includes(active.sandbox)) {
        void teardown().then(() => set({ ...IDLE_STATUS }))
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/capture/session.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/main/capture/session.ts tests/main/capture/session.test.ts
git commit -m "feat(capture): capture session manager with fail-closed verification"
```

---

### Task 7: IPC surface, preload and renderer client

**Files:**
- Modify: `src/main/ipc.ts` (Deps interface ~line 36; handler type block ~line 122; handler bodies ~line 468; `registerIpc` ~line 597)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/ipc/client.ts`
- Test: `tests/main/ipc-capture.test.ts`

**Interfaces:**
- Consumes: `CaptureSession` (Task 6), `readBurpSettings`/`writeBurpSettings` (Task 1), `readCaFile` (Task 3), `buildBurpUserConfig` (Task 2).
- Produces IPC channels: `capture:status`, `capture:enable`, `capture:disable`, `capture:settingsGet`, `capture:settingsSet`, `capture:caInspect`, `capture:burpConfig`; and matching `api.*` methods `captureStatus`, `captureEnable`, `captureDisable`, `captureSettingsGet`, `captureSettingsSet`, `captureCaInspect`, `captureBurpConfig`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/ipc-capture.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'
import { IDLE_STATUS } from '../../src/shared/capture'

function deps(over: Record<string, unknown> = {}) {
  const prefs = new Map<string, string>()
  const store = {
    getPref: (k: string) => prefs.get(k) ?? null,
    setPref: (k: string, v: string) => { prefs.set(k, v) }
  }
  const capture = {
    status: vi.fn(() => IDLE_STATUS),
    enable: vi.fn(async (name: string) => ({ sandbox: name, state: 'on', checks: [] })),
    disable: vi.fn(async () => IDLE_STATUS),
    onRunningInstances: vi.fn()
  }
  return { adapter: {} as never, store, probes: {} as never, openTerminal: vi.fn(), capture, ...over } as never
}

describe('capture IPC', () => {
  it('returns the current status', async () => {
    const h = buildHandlers(deps())
    expect(await h['capture:status']()).toEqual({ ok: true, data: IDLE_STATUS })
  })

  it('enables and disables a sandbox', async () => {
    const h = buildHandlers(deps())
    const r = await h['capture:enable']('demo', false)
    expect(r.ok && r.data.state).toBe('on')
    expect((await h['capture:disable']()).ok).toBe(true)
  })

  it('passes the force flag through for Enable anyway', async () => {
    const d = deps() as unknown as { capture: { enable: ReturnType<typeof vi.fn> } }
    const h = buildHandlers(d as never)
    await h['capture:enable']('demo', true)
    expect(d.capture.enable).toHaveBeenCalledWith('demo', { force: true })
  })

  it('round-trips Burp settings through app_prefs', async () => {
    const h = buildHandlers(deps())
    const first = await h['capture:settingsGet']()
    expect(first.ok && first.data.proxyPort).toBe(8080)
    const set = await h['capture:settingsSet']({ proxyPort: 9090, caPath: 'C:/ca.cer' })
    expect(set.ok && set.data.proxyPort).toBe(9090)
    const again = await h['capture:settingsGet']()
    expect(again.ok && again.data.caPath).toBe('C:/ca.cer')
  })

  it('reports an invalid port as an error result rather than throwing', async () => {
    const h = buildHandlers(deps())
    const r = await h['capture:settingsSet']({ proxyPort: 0 })
    expect(r.ok).toBe(false)
  })

  it('inspects a CA file and reports parse failures as error results', async () => {
    const good = buildHandlers(deps({ readCa: () => ({ pem: 'P', subject: 'CN=Burp', commonName: 'Burp', expires: '2036' }) }))
    const r = await good['capture:caInspect']('C:/ca.cer')
    expect(r.ok && r.data.commonName).toBe('Burp')

    const bad = buildHandlers(deps({ readCa: () => { throw new Error('not a valid certificate') } }))
    expect((await bad['capture:caInspect']('C:/x')).ok).toBe(false)
  })

  it('builds the Burp config from the configured upstream port', async () => {
    const h = buildHandlers(deps())
    await h['capture:settingsSet']({ upstreamPort: 3200 })
    const r = await h['capture:burpConfig']()
    expect(r.ok && JSON.parse(r.data).user_options.connections.upstream_proxy.servers[0].proxy_port).toBe(3200)
  })

  it('exports the config through the Save dialog and reports the path', async () => {
    const saveFile = vi.fn(async () => 'C:/out/burp-upstream-proxy.json')
    const h = buildHandlers(deps({ saveFile }))
    const r = await h['capture:exportConfig']()
    expect(r.ok && r.data.path).toBe('C:/out/burp-upstream-proxy.json')
    expect(saveFile).toHaveBeenCalledWith('burp-upstream-proxy.json', expect.stringContaining('upstream_proxy'))
  })

  it('reports a cancelled export rather than treating it as a failure', async () => {
    const h = buildHandlers(deps({ saveFile: vi.fn(async () => null) }))
    const r = await h['capture:exportConfig']()
    expect(r.ok && r.data.canceled).toBe(true)
  })

  it('reports a clear error when no capture session is wired', async () => {
    const h = buildHandlers(deps({ capture: undefined }))
    expect((await h['capture:enable']('demo', false)).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/ipc-capture.test.ts`
Expected: FAIL — `h['capture:status'] is not a function`.

- [ ] **Step 3: Extend the main-process IPC**

In `src/main/ipc.ts`, add imports near the other `./capture` siblings:

```typescript
import type { CaptureSession } from './capture/session'
import { readBurpSettings, writeBurpSettings } from './capture/settings'
import { readCaFile, type CaInfo } from './capture/ca'
import { buildBurpUserConfig, BURP_CONFIG_FILENAME } from './capture/burp-config'
import type { BurpSettings, CaptureStatus } from '@shared/capture'
```

`deps.saveFile` already exists on `Deps` (it backs `def:export`) — no new dependency is needed.

Add to the `Deps` interface (after `now?`):

```typescript
  /** Burp traffic-capture session manager. Absent in tests that do not exercise capture. */
  capture?: CaptureSession
  /** Override CA reading (tests only). */
  readCa?: (path: string) => CaInfo
```

Add to the `buildHandlers` return type block (after `'prefs:set'`):

```typescript
  'capture:status': () => Promise<Result<CaptureStatus>>
  'capture:enable': (name: string, force: boolean) => Promise<Result<CaptureStatus>>
  'capture:disable': () => Promise<Result<CaptureStatus>>
  'capture:settingsGet': () => Promise<Result<BurpSettings>>
  'capture:settingsSet': (patch: Partial<BurpSettings>) => Promise<Result<BurpSettings>>
  'capture:caInspect': (path: string) => Promise<Result<CaInfo>>
  'capture:burpConfig': () => Promise<Result<string>>
  'capture:exportConfig': () => Promise<Result<{ canceled?: boolean; path?: string }>>
```

Add the handler bodies alongside `'prefs:set'`:

```typescript
    'capture:status': () => wrap(async () => deps.capture?.status() ?? { sandbox: null, state: 'off' as const, checks: [] }),
    'capture:enable': (name, force) => wrap(async () => requireCapture(deps).enable(name, { force })),
    'capture:disable': () => wrap(async () => requireCapture(deps).disable()),
    'capture:settingsGet': () => wrap(async () => readBurpSettings(deps.store)),
    'capture:settingsSet': (patch) => wrap(async () => writeBurpSettings(deps.store, patch)),
    'capture:caInspect': (path) => wrap(async () => (deps.readCa ?? readCaFile)(path)),
    'capture:burpConfig': () => wrap(async () => buildBurpUserConfig(readBurpSettings(deps.store).upstreamPort)),
    // Writing to disk is a main-process job — reuse the same Save dialog def:export uses.
    'capture:exportConfig': () => wrap(async () => {
      if (!deps.saveFile) throw new Error('file export is not available in this session')
      const contents = buildBurpUserConfig(readBurpSettings(deps.store).upstreamPort)
      const path = await deps.saveFile(BURP_CONFIG_FILENAME, contents)
      return path === null ? { canceled: true } : { path }
    }),
```

Add this helper next to `requireCreds`:

```typescript
function requireCapture(deps: Deps): CaptureSession {
  if (!deps.capture) throw new Error('traffic capture is not available in this session')
  return deps.capture
}
```

Register the channels in `registerIpc`, beside the `prefs:*` registrations:

```typescript
  ipcMain.handle('capture:status', () => handlers['capture:status']())
  ipcMain.handle('capture:enable', (_e, name: string, force: boolean) => handlers['capture:enable'](name, force))
  ipcMain.handle('capture:disable', () => handlers['capture:disable']())
  ipcMain.handle('capture:settingsGet', () => handlers['capture:settingsGet']())
  ipcMain.handle('capture:settingsSet', (_e, patch: Partial<BurpSettings>) => handlers['capture:settingsSet'](patch))
  ipcMain.handle('capture:caInspect', (_e, path: string) => handlers['capture:caInspect'](path))
  ipcMain.handle('capture:burpConfig', () => handlers['capture:burpConfig']())
  ipcMain.handle('capture:exportConfig', () => handlers['capture:exportConfig']())
```

- [ ] **Step 4: Extend preload and the renderer client**

In `src/preload/index.ts`, add to the `api` object (before `setTitleBarOverlay`):

```typescript
  captureStatus: () => ipcRenderer.invoke('capture:status'),
  captureEnable: (name: string, force = false) => ipcRenderer.invoke('capture:enable', name, force),
  captureDisable: () => ipcRenderer.invoke('capture:disable'),
  captureSettingsGet: () => ipcRenderer.invoke('capture:settingsGet'),
  captureSettingsSet: (patch: Partial<BurpSettings>) => ipcRenderer.invoke('capture:settingsSet', patch),
  captureCaInspect: (path: string) => ipcRenderer.invoke('capture:caInspect', path),
  captureBurpConfig: () => ipcRenderer.invoke('capture:burpConfig'),
  captureExportConfig: () => ipcRenderer.invoke('capture:exportConfig'),
```

and add the type import at the top:

```typescript
import type { BurpSettings } from '@shared/capture'
```

In `src/renderer/ipc/client.ts`, add the import:

```typescript
import type { BurpSettings, CaptureStatus } from '@shared/capture'
```

add to `interface Api` (before `setTitleBarOverlay`):

```typescript
  captureStatus(): Promise<Result<CaptureStatus>>
  captureEnable(name: string, force?: boolean): Promise<Result<CaptureStatus>>
  captureDisable(): Promise<Result<CaptureStatus>>
  captureSettingsGet(): Promise<Result<BurpSettings>>
  captureSettingsSet(patch: Partial<BurpSettings>): Promise<Result<BurpSettings>>
  captureCaInspect(path: string): Promise<Result<{ pem: string; subject: string; commonName: string; expires: string }>>
  captureBurpConfig(): Promise<Result<string>>
  captureExportConfig(): Promise<Result<{ canceled?: boolean; path?: string }>>
```

and to the no-IPC fallback object:

```typescript
  captureStatus: async () => ({ ok: true, data: { sandbox: null, state: 'off' as const, checks: [] } }),
  captureEnable: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  captureDisable: async () => ({ ok: true, data: { sandbox: null, state: 'off' as const, checks: [] } }),
  captureSettingsGet: async () => ({ ok: true, data: { caPath: '', proxyPort: 8080, upstreamPort: 3128 } }),
  captureSettingsSet: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  captureCaInspect: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  captureBurpConfig: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
  captureExportConfig: async () => ({ ok: false, error: { kind: 'generic', message: 'IPC unavailable' } }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/main/ipc-capture.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: all green — the new `Deps` fields are optional, so existing IPC tests are unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/ipc/client.ts tests/main/ipc-capture.test.ts
git commit -m "feat(capture): IPC surface for capture control and Burp settings"
```

---

### Task 8: Settings card — Traffic capture (Burp)

**Files:**
- Create: `src/renderer/screens/BurpSettings.tsx`
- Modify: `src/renderer/screens/Settings.tsx`
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Test: `tests/renderer/BurpSettings.test.tsx`

**Interfaces:**
- Consumes: `api.captureSettingsGet/Set`, `api.captureCaInspect`, `api.captureBurpConfig`, `api.pickFile` (Task 7).
- Produces: `<BurpSettings />` — self-contained, loads its own state on mount.

- [ ] **Step 1: Add i18n keys**

In `src/renderer/i18n/en.ts`, add a `capture` block at the top level of the exported object:

```typescript
  capture: {
    settingsTitle: 'Traffic capture (Burp)',
    settingsHint: 'Route a sandbox\u2019s traffic through Burp Suite to inspect requests. Enable it per sandbox on the Monitoring tab.',
    caLabel: 'Burp CA certificate',
    caHint: 'Burp \u203a Proxy \u203a Proxy settings \u203a Import / export CA certificate. DER or PEM.',
    caBrowse: 'Choose file\u2026',
    caValid: '{name} \u00b7 expires {expires}',
    proxyPort: 'Burp proxy port',
    advanced: 'Advanced',
    upstreamPort: 'Upstream port',
    upstreamHint: 'Burp\u2019s upstream proxy points at this host port. It must match the exported config.',
    burpRuleTitle: 'Burp upstream rule',
    burpRuleHint: 'Burp must chain back into the sbx proxy, or authenticated requests return 401. Import this once via Burp \u203a Settings \u203a User settings \u203a Import.',
    exportConfig: 'Export Burp config',
    copyConfig: 'Copy',
    copied: 'Copied',
    saved: 'Saved'
  },
```

In `src/renderer/i18n/de.ts`, add the matching block:

```typescript
  capture: {
    settingsTitle: 'Datenverkehr aufzeichnen (Burp)',
    settingsHint: 'Den Datenverkehr einer Sandbox \u00fcber Burp Suite leiten, um Anfragen zu inspizieren. Pro Sandbox im Tab \u201eMonitoring\u201c aktivierbar.',
    caLabel: 'Burp-CA-Zertifikat',
    caHint: 'Burp \u203a Proxy \u203a Proxy settings \u203a Import / export CA certificate. DER oder PEM.',
    caBrowse: 'Datei w\u00e4hlen\u2026',
    caValid: '{name} \u00b7 g\u00fcltig bis {expires}',
    proxyPort: 'Burp-Proxy-Port',
    advanced: 'Erweitert',
    upstreamPort: 'Upstream-Port',
    upstreamHint: 'Burps Upstream-Proxy zeigt auf diesen Host-Port. Er muss zur exportierten Konfiguration passen.',
    burpRuleTitle: 'Burp-Upstream-Regel',
    burpRuleHint: 'Burp muss zur\u00fcck in den sbx-Proxy verketten, sonst liefern authentifizierte Anfragen 401. Einmalig importieren \u00fcber Burp \u203a Settings \u203a User settings \u203a Import.',
    exportConfig: 'Burp-Konfiguration exportieren',
    copyConfig: 'Kopieren',
    copied: 'Kopiert',
    saved: 'Gespeichert'
  },
```

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/BurpSettings.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BurpSettings } from '../../src/renderer/screens/BurpSettings'

// `src/renderer/ipc/client` resolves `api` from `globalThis.api` ONCE, at module-eval time,
// so assigning `globalThis.api` in a hook is too late — the component would see the
// "IPC unavailable" fallbacks. Mock the module instead, which is what all nine existing
// renderer tests in this repo do. `vi.hoisted` lets the mock factory reference the object
// without a TDZ error. `clearAllMocks` calls mockClear, preserving the implementations.
const api = vi.hoisted(() => ({
  captureSettingsGet: vi.fn(async () => ({ ok: true, data: { caPath: '', proxyPort: 8080, upstreamPort: 3128 } })),
  captureSettingsSet: vi.fn(async (patch: Record<string, unknown>) => ({ ok: true, data: { caPath: '', proxyPort: 8080, upstreamPort: 3128, ...patch } })),
  captureCaInspect: vi.fn(async () => ({ ok: true, data: { pem: 'P', subject: 'CN=PortSwigger CA', commonName: 'PortSwigger CA', expires: 'Aug 21 2036 GMT' } })),
  captureBurpConfig: vi.fn(async () => ({ ok: true, data: '{"user_options":{}}' })),
  captureExportConfig: vi.fn(async () => ({ ok: true, data: { path: 'C:/out.json' } })),
  pickFile: vi.fn(async () => 'C:/burp.cer')
}))
vi.mock('../../src/renderer/ipc/client', () => ({ api }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BurpSettings', () => {
  it('renders the CA and proxy-port fields', async () => {
    render(<BurpSettings />)
    expect(await screen.findByLabelText(/burp ca certificate/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/burp proxy port/i)).toBeInTheDocument()
  })

  it('picks a CA file, saves it, and confirms with the parsed subject and expiry', async () => {
    render(<BurpSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /choose file/i }))
    await waitFor(() => expect(api.captureSettingsSet).toHaveBeenCalledWith({ caPath: 'C:/burp.cer' }))
    expect(await screen.findByText(/PortSwigger CA/)).toBeInTheDocument()
    expect(screen.getByText(/2036/)).toBeInTheDocument()
  })

  it('shows a parse error instead of a confirmation when the file is not a certificate', async () => {
    api.captureCaInspect.mockResolvedValueOnce({ ok: false, error: { kind: 'generic', message: 'not a valid certificate' } } as never)
    render(<BurpSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /choose file/i }))
    expect(await screen.findByText(/not a valid certificate/i)).toBeInTheDocument()
  })

  it('saves an edited proxy port on blur', async () => {
    render(<BurpSettings />)
    const input = await screen.findByLabelText(/burp proxy port/i)
    fireEvent.change(input, { target: { value: '8081' } })
    fireEvent.blur(input)
    await waitFor(() => expect(api.captureSettingsSet).toHaveBeenCalledWith({ proxyPort: 8081 }))
  })

  it('does not save an invalid port', async () => {
    render(<BurpSettings />)
    const input = await screen.findByLabelText(/burp proxy port/i)
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    await waitFor(() => expect(api.captureSettingsSet).not.toHaveBeenCalled())
  })

  it('exposes the upstream port only under Advanced', async () => {
    render(<BurpSettings />)
    await screen.findByLabelText(/burp proxy port/i)
    expect(screen.queryByLabelText(/upstream port/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }))
    expect(screen.getByLabelText(/upstream port/i)).toBeInTheDocument()
  })

  it('explains the upstream rule and saves the config to a file', async () => {
    render(<BurpSettings />)
    expect(await screen.findByText(/401/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /export burp config/i }))
    await waitFor(() => expect(api.captureExportConfig).toHaveBeenCalled())
  })

  it('copies the config to the clipboard', async () => {
    render(<BurpSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /^copy$/i }))
    await waitFor(() => expect(api.captureBurpConfig).toHaveBeenCalled())
  })

  it('surfaces an export failure', async () => {
    api.captureExportConfig.mockResolvedValueOnce({ ok: false, error: { kind: 'generic', message: 'disk full' } } as never)
    render(<BurpSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /export burp config/i }))
    expect(await screen.findByText(/disk full/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/renderer/BurpSettings.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the component**

Create `src/renderer/screens/BurpSettings.tsx`:

```typescript
import { useCallback, useEffect, useState } from 'react'
import type { BurpSettings as Settings } from '@shared/capture'
import { api } from '../ipc/client'
import { useT } from '../i18n'

/** A union, so it must be a type alias — `interface` cannot express one. */
type CaState = { ok: true; name: string; expires: string } | { ok: false; message: string }

/**
 * Settings card for Burp traffic capture. Only two fields genuinely vary — the CA path and
 * Burp's port — so the upstream port sits under Advanced and the two in-sandbox ports are
 * chosen dynamically at enable time rather than configured.
 */
export function BurpSettings(): JSX.Element {
  const t = useT()
  const [settings, setSettings] = useState<Settings>({ caPath: '', proxyPort: 8080, upstreamPort: 3128 })
  const [ca, setCa] = useState<CaState | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const inspect = useCallback(async (path: string) => {
    if (!path) { setCa(null); return }
    const r = await api.captureCaInspect(path)
    setCa(r.ok ? { ok: true, name: r.data.commonName, expires: r.data.expires } : { ok: false, message: r.error.message })
  }, [])

  useEffect(() => {
    void api.captureSettingsGet().then((r) => {
      if (!r.ok) return
      setSettings(r.data)
      void inspect(r.data.caPath)
    })
  }, [inspect])

  async function save(patch: Partial<Settings>): Promise<void> {
    setNotice(null)
    const r = await api.captureSettingsSet(patch)
    if (r.ok) setSettings(r.data); else setNotice(r.error.message)
  }

  async function onBrowse(): Promise<void> {
    const path = await api.pickFile()
    if (!path) return
    await save({ caPath: path })
    await inspect(path)
  }

  // Ports are saved on blur, not on every keystroke — an in-progress "80" must not persist.
  function onPortBlur(key: 'proxyPort' | 'upstreamPort', raw: string): void {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 65535) return
    if (n === settings[key]) return
    void save({ [key]: n } as Partial<Settings>)
  }

  async function onCopy(): Promise<void> {
    const r = await api.captureBurpConfig()
    if (!r.ok) { setNotice(r.error.message); return }
    await navigator.clipboard?.writeText(r.data)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Writing the file happens in main (Save dialog); the renderer only reports failure.
  async function onExport(): Promise<void> {
    const r = await api.captureExportConfig()
    if (!r.ok) setNotice(r.error.message)
  }

  return (
    <div className="card" style={{ padding: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
      <h3 className="section-title" style={{ fontSize: 15, marginBottom: 'var(--space-1)' }}>{t('capture.settingsTitle')}</h3>
      <p className="section-desc" style={{ marginTop: 0 }}>{t('capture.settingsHint')}</p>

      <label htmlFor="burp-ca" style={{ display: 'block', fontSize: 13, fontWeight: 510 }}>{t('capture.caLabel')}</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <input
          id="burp-ca"
          type="text"
          value={settings.caPath}
          onChange={(e) => setSettings((s) => ({ ...s, caPath: e.target.value }))}
          onBlur={(e) => { void save({ caPath: e.target.value }).then(() => inspect(e.target.value)) }}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onBrowse()}>{t('capture.caBrowse')}</button>
      </div>
      <p className="section-desc" style={{ fontSize: 12, marginTop: 'var(--space-1)' }}>{t('capture.caHint')}</p>
      {ca?.ok === true && <p style={{ fontSize: 12, color: 'var(--success, var(--accent))' }}>{t('capture.caValid', { name: ca.name, expires: ca.expires })}</p>}
      {ca?.ok === false && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{ca.message}</p>}

      <label htmlFor="burp-port" style={{ display: 'block', fontSize: 13, fontWeight: 510, marginTop: 'var(--space-3)' }}>{t('capture.proxyPort')}</label>
      <input
        id="burp-port"
        type="number"
        defaultValue={settings.proxyPort}
        key={`p-${settings.proxyPort}`}
        onBlur={(e) => onPortBlur('proxyPort', e.target.value)}
        style={{ width: 120 }}
      />

      <div style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
          {advanced ? '▾' : '▸'} {t('capture.advanced')}
        </button>
        {advanced && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <label htmlFor="burp-upstream" style={{ display: 'block', fontSize: 13, fontWeight: 510 }}>{t('capture.upstreamPort')}</label>
            <input
              id="burp-upstream"
              type="number"
              defaultValue={settings.upstreamPort}
              key={`u-${settings.upstreamPort}`}
              onBlur={(e) => onPortBlur('upstreamPort', e.target.value)}
              style={{ width: 120 }}
            />
            <p className="section-desc" style={{ fontSize: 12 }}>{t('capture.upstreamHint')}</p>
          </div>
        )}
      </div>

      <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border)' }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t('capture.burpRuleTitle')}</h4>
        <p className="section-desc" style={{ fontSize: 12 }}>{t('capture.burpRuleHint')}</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onExport()}>{t('capture.exportConfig')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onCopy()}>{copied ? t('capture.copied') : t('capture.copyConfig')}</button>
        </div>
      </div>

      {notice && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{notice}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Mount it in Settings**

Mounting `BurpSettings` makes `Settings` call `api.captureSettingsGet()` on mount, which
breaks the pre-existing `tests/renderer/Settings.test.tsx` — it mocks the IPC client with a
*partial* `api`, so the new call is `undefined`. Add `captureSettingsGet` and
`captureCaInspect` stubs to that file's mock. This is an unavoidable consequence of this
step, not a design change.

In `src/renderer/screens/Settings.tsx`, add the import:

```typescript
import { BurpSettings } from './BurpSettings'
```

and render it after `<CredentialStorageGuide status={storage} />`:

```typescript
      <BurpSettings />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/BurpSettings.test.tsx tests/renderer/i18n.test.ts`
Expected: PASS (9 new tests; i18n unaffected).

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/screens/BurpSettings.tsx src/renderer/screens/Settings.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/BurpSettings.test.tsx
git commit -m "feat(capture): Burp settings card with CA validation and config export"
```

---

### Task 9: Capture card on the Monitoring tab

**Files:**
- Create: `src/renderer/screens/detail/CaptureCard.tsx`
- Modify: `src/renderer/screens/detail/MonitoringTab.tsx`
- Modify: `src/renderer/screens/InstanceDetail.tsx`
- Modify: `src/renderer/i18n/en.ts`, `src/renderer/i18n/de.ts`
- Test: `tests/renderer/detail/CaptureCard.test.tsx`

**Interfaces:**
- Consumes: `CaptureStatus` from `@shared/capture`.
- Produces: `<CaptureCard status running sandbox onEnable onDisable onOpenShell />` — a pure presentational component; all IPC lives in `InstanceDetail`.

- [ ] **Step 1: Add i18n keys**

Append to the `capture` block in `src/renderer/i18n/en.ts`:

```typescript
    cardTitle: 'Traffic capture',
    on: 'Capturing via Burp',
    off: 'Not capturing',
    starting: 'Starting\u2026',
    enable: 'Enable',
    disable: 'Disable',
    enableAnyway: 'Enable anyway',
    agentNotCaptured: 'The running agent is not captured \u2014 it keeps the environment it started with. Open a new shell or restart it.',
    openShell: 'Open shell',
    needsRunning: 'The sandbox must be running.',
    needsCa: 'Set a Burp CA certificate in Settings first.',
    otherSandbox: '{name} is already being captured.',
    phasePreflight: 'Checking prerequisites',
    phaseCa: 'Installing the Burp CA',
    phaseProfile: 'Configuring the proxy environment',
    phaseTunnel: 'Opening the tunnel',
    phaseVerify: 'Verifying',
    checkBurp: 'Burp',
    checkCa: 'CA installed',
    checkTunnel: 'Tunnel',
    checkConcurrency: 'Concurrency',
    checkCredential: 'Credentials',
    ports: 'Burp 127.0.0.1:{proxy} \u00b7 upstream :{upstream}'
```

Append the matching German keys to `src/renderer/i18n/de.ts`:

```typescript
    cardTitle: 'Datenverkehr aufzeichnen',
    on: 'Aufzeichnung \u00fcber Burp aktiv',
    off: 'Keine Aufzeichnung',
    starting: 'Wird gestartet\u2026',
    enable: 'Aktivieren',
    disable: 'Deaktivieren',
    enableAnyway: 'Trotzdem aktivieren',
    agentNotCaptured: 'Der laufende Agent wird nicht aufgezeichnet \u2014 er beh\u00e4lt seine Startumgebung. \u00d6ffne eine neue Shell oder starte ihn neu.',
    openShell: 'Shell \u00f6ffnen',
    needsRunning: 'Die Sandbox muss laufen.',
    needsCa: 'Zuerst ein Burp-CA-Zertifikat in den Einstellungen hinterlegen.',
    otherSandbox: '{name} wird bereits aufgezeichnet.',
    phasePreflight: 'Voraussetzungen werden gepr\u00fcft',
    phaseCa: 'Burp-CA wird installiert',
    phaseProfile: 'Proxy-Umgebung wird konfiguriert',
    phaseTunnel: 'Tunnel wird ge\u00f6ffnet',
    phaseVerify: 'Wird verifiziert',
    checkBurp: 'Burp',
    checkCa: 'CA installiert',
    checkTunnel: 'Tunnel',
    checkConcurrency: 'Parallelit\u00e4t',
    checkCredential: 'Zugangsdaten',
    ports: 'Burp 127.0.0.1:{proxy} \u00b7 Upstream :{upstream}'
```

- [ ] **Step 2: Write the failing test**

Create `tests/renderer/detail/CaptureCard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CaptureCard } from '../../../src/renderer/screens/detail/CaptureCard'
import { IDLE_STATUS, type CaptureStatus } from '../../../src/shared/capture'

const base = { sandbox: 'demo', running: true, hasCa: true, onEnable: vi.fn(), onDisable: vi.fn(), onOpenShell: vi.fn() }
const onStatus: CaptureStatus = {
  sandbox: 'demo', state: 'on', ports: { proxy: 8080, upstream: 3128, relay: 3129, app: 18080 },
  checks: [
    { id: 'ca', ok: true, detail: 'PortSwigger CA' },
    { id: 'concurrency', ok: true, detail: '12/12' },
    { id: 'credential', ok: true, detail: 'anthropic 200' }
  ]
}

describe('CaptureCard', () => {
  it('offers Enable when off', () => {
    render(<CaptureCard {...base} status={IDLE_STATUS} />)
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeEnabled()
  })

  it('calls onEnable without force', () => {
    const onEnable = vi.fn()
    render(<CaptureCard {...base} onEnable={onEnable} status={IDLE_STATUS} />)
    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }))
    expect(onEnable).toHaveBeenCalledWith(false)
  })

  it('disables Enable with a reason when the sandbox is stopped', () => {
    render(<CaptureCard {...base} running={false} status={IDLE_STATUS} />)
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeDisabled()
    expect(screen.getByText(/must be running/i)).toBeInTheDocument()
  })

  it('disables Enable with a reason when no CA is configured', () => {
    render(<CaptureCard {...base} hasCa={false} status={IDLE_STATUS} />)
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeDisabled()
    expect(screen.getByText(/ca certificate/i)).toBeInTheDocument()
  })

  it('names the occupant when another sandbox is capturing', () => {
    render(<CaptureCard {...base} status={{ ...onStatus, sandbox: 'other' }} />)
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeDisabled()
    expect(screen.getByText(/other is already being captured/i)).toBeInTheDocument()
  })

  it('shows live state, ports and check results when on', () => {
    render(<CaptureCard {...base} status={onStatus} />)
    expect(screen.getByText(/capturing via burp/i)).toBeInTheDocument()
    expect(screen.getByText(/127\.0\.0\.1:8080/)).toBeInTheDocument()
    expect(screen.getByText('12/12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument()
  })

  it('always warns that the running agent is not captured, with a shell action', () => {
    const onOpenShell = vi.fn()
    render(<CaptureCard {...base} status={onStatus} onOpenShell={onOpenShell} />)
    expect(screen.getByText(/running agent is not captured/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open shell/i }))
    expect(onOpenShell).toHaveBeenCalled()
  })

  it('names the phase while starting', () => {
    render(<CaptureCard {...base} status={{ sandbox: 'demo', state: 'starting', phase: 'tunnel', checks: [] }} />)
    expect(screen.getByText(/opening the tunnel/i)).toBeInTheDocument()
  })

  it('shows the failing phase message and an Enable anyway escape hatch on error', () => {
    const onEnable = vi.fn()
    render(<CaptureCard {...base} onEnable={onEnable}
      status={{ sandbox: 'demo', state: 'error', phase: 'verify', checks: [], message: 'Burp is not chaining back' }} />)
    expect(screen.getByText(/not chaining back/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /enable anyway/i }))
    expect(onEnable).toHaveBeenCalledWith(true)
  })

  it('offers no Enable anyway for a preflight failure — forcing cannot help', () => {
    render(<CaptureCard {...base}
      status={{ sandbox: 'demo', state: 'error', phase: 'preflight', checks: [], message: 'socat is not installed' }} />)
    expect(screen.queryByRole('button', { name: /enable anyway/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/renderer/detail/CaptureCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the component**

Create `src/renderer/screens/detail/CaptureCard.tsx`:

```typescript
import type { CaptureCheck, CapturePhase, CaptureStatus } from '@shared/capture'
import { useT, type TFn } from '../../i18n'

const PHASE_KEYS: Record<CapturePhase, string> = {
  preflight: 'capture.phasePreflight',
  ca: 'capture.phaseCa',
  profile: 'capture.phaseProfile',
  tunnel: 'capture.phaseTunnel',
  verify: 'capture.phaseVerify'
}

const CHECK_KEYS: Record<string, string> = {
  burp: 'capture.checkBurp',
  ca: 'capture.checkCa',
  tunnel: 'capture.checkTunnel',
  concurrency: 'capture.checkConcurrency',
  credential: 'capture.checkCredential'
}

function CheckPill({ check, t }: { check: CaptureCheck; t: TFn }): JSX.Element {
  const label = CHECK_KEYS[check.id] ? t(CHECK_KEYS[check.id]) : check.id
  return (
    <span title={check.detail} style={{ fontSize: 12, color: check.ok ? 'var(--success, var(--accent))' : 'var(--danger)' }}>
      {/* `detail` needs its own span: testing-library's getByText matches an element's
          joined direct text nodes, so inlining it here makes the pill's queryable text
          "✓ Concurrency 12/12" and the test's getByText('12/12') can never match. */}
      {check.ok ? '✓' : '✕'} {label} <span className="capture-check-detail">{check.detail}</span>
    </span>
  )
}

/**
 * Traffic-capture control for one sandbox, on the Monitoring tab — next to the traffic it
 * deepens. Purely presentational: `status` is global (only one session exists), so this
 * compares `status.sandbox` to its own `sandbox` to decide what it is looking at.
 */
export function CaptureCard({ status, sandbox, running, hasCa, onEnable, onDisable, onOpenShell }: {
  status: CaptureStatus
  sandbox: string
  running: boolean
  hasCa: boolean
  onEnable: (force: boolean) => void
  onDisable: () => void
  onOpenShell: () => void
}): JSX.Element {
  const t = useT()
  const mine = status.sandbox === sandbox
  const occupiedByOther = status.sandbox !== null && !mine
  const state = mine ? status.state : 'off'

  // Forcing past preflight is meaningless — a missing CA or absent socat is not a gate that
  // "enable anyway" can skip. Only the verify-phase credential gate is overridable.
  const canForce = mine && state === 'error' && status.phase === 'verify'

  let disabledReason: string | null = null
  if (!running) disabledReason = t('capture.needsRunning')
  else if (!hasCa) disabledReason = t('capture.needsCa')
  else if (occupiedByOther) disabledReason = t('capture.otherSandbox', { name: status.sandbox ?? '' })

  return (
    <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div className="card-title" style={{ flex: 1 }}>
          {t('capture.cardTitle')}
          <span style={{ marginLeft: 'var(--space-3)', fontWeight: 400, fontSize: 13, color: state === 'on' ? 'var(--success, var(--accent))' : 'var(--text-muted)' }}>
            {state === 'on' && `● ${t('capture.on')}`}
            {state === 'starting' && t('capture.starting')}
            {state === 'off' && t('capture.off')}
          </span>
        </div>
        {state === 'on'
          ? <button className="btn btn-secondary btn-sm" onClick={onDisable}>{t('capture.disable')}</button>
          : (
            <button className="btn btn-primary btn-sm" disabled={disabledReason !== null || state === 'starting'} onClick={() => onEnable(false)}>
              {t('capture.enable')}
            </button>
          )}
      </div>

      {disabledReason && <p className="section-desc" style={{ fontSize: 12, marginBottom: 0 }}>{disabledReason}</p>}

      {mine && state === 'starting' && status.phase && (
        <p className="section-desc" style={{ fontSize: 12, marginBottom: 0 }}>{t(PHASE_KEYS[status.phase])}</p>
      )}

      {mine && state === 'on' && status.ports && (
        <p className="section-desc" style={{ fontSize: 12, marginBottom: 'var(--space-2)' }}>
          {t('capture.ports', { proxy: status.ports.proxy, upstream: status.ports.upstream })}
        </p>
      )}

      {mine && status.checks.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          {status.checks.map((c) => <CheckPill key={c.id} check={c} t={t} />)}
        </div>
      )}

      {mine && state === 'error' && status.message && (
        <div role="alert" style={{ marginTop: 'var(--space-2)' }}>
          <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{status.message}</p>
          {canForce && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--space-2)' }} onClick={() => onEnable(true)}>
              {t('capture.enableAnyway')}
            </button>
          )}
        </div>
      )}

      {mine && state === 'on' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <span style={{ fontSize: 12 }}>⚠ {t('capture.agentNotCaptured')}</span>
          <button className="btn btn-ghost btn-sm" onClick={onOpenShell}>{t('capture.openShell')}</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Render it from MonitoringTab**

In `src/renderer/screens/detail/MonitoringTab.tsx`, add to the props type:

```typescript
  /** Rendered above the resource card; omitted when the caller has no capture wiring. */
  captureSlot?: JSX.Element
```

destructure `captureSlot` in the signature and render it as the first child of the returned `<div>`:

```typescript
    <div>
      {captureSlot}
      <ResourceCard stats={stats} running={running} onFetch={onFetchStats} t={t} />
```

- [ ] **Step 6: Wire it in InstanceDetail**

In `src/renderer/screens/InstanceDetail.tsx`, add the imports:

```typescript
import { CaptureCard } from './detail/CaptureCard'
import { IDLE_STATUS, type CaptureStatus } from '@shared/capture'
```

add state and polling next to the existing policy polling:

```typescript
  const [capture, setCapture] = useState<CaptureStatus>(IDLE_STATUS)
  const [hasCa, setHasCa] = useState(false)
  useEffect(() => { void api.captureSettingsGet().then((r) => { if (r.ok) setHasCa(r.data.caPath.trim().length > 0) }) }, [])
  const reloadCapture = useCallback(async () => {
    const r = await api.captureStatus()
    if (r.ok) setCapture(r.data)
  }, [])
  // Polled on the same interval as the policy log rather than via a new push channel.
  useEffect(() => {
    if (tab !== 'monitoring') return
    void reloadCapture()
    const id = setInterval(() => void reloadCapture(), 5000)
    return () => clearInterval(id)
  }, [tab, reloadCapture])
```

and pass the slot into `<MonitoringTab …>`:

```typescript
          captureSlot={
            <CaptureCard
              status={capture}
              sandbox={instance.name}
              running={running}
              hasCa={hasCa}
              onEnable={async (force) => { const r = await api.captureEnable(instance.name, force); if (r.ok) setCapture(r.data) }}
              onDisable={async () => { const r = await api.captureDisable(); if (r.ok) setCapture(r.data) }}
              onOpenShell={() => onShell(instance.name)}
            />
          }
```

- [ ] **Step 7: Run the renderer tests**

Run: `npx vitest run tests/renderer`
Expected: PASS — 10 new CaptureCard tests; existing MonitoringTab tests still pass because `captureSlot` is optional.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/screens/detail/CaptureCard.tsx src/renderer/screens/detail/MonitoringTab.tsx src/renderer/screens/InstanceDetail.tsx src/renderer/i18n/en.ts src/renderer/i18n/de.ts tests/renderer/detail/CaptureCard.test.tsx
git commit -m "feat(capture): capture card on the Monitoring tab"
```

---

### Task 10: Wire the session into the app lifecycle

**Files:**
- Create: `src/main/capture/spawn.ts`
- Modify: `src/main/index.ts` (`registerIpc` call ~line 190; add a `before-quit` handler)
- Modify: `src/main/ipc.ts` (feed the reconciler's running instances to the session in `instances:list`)
- Test: `tests/main/capture/spawn.test.ts`, `tests/main/ipc-capture-lifecycle.test.ts`

**Interfaces:**
- Consumes: `CaptureChild`, `createCaptureSession` (Task 6).
- Produces: `spawnSshChild(args: string[]): CaptureChild`.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/capture/spawn.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { spawnSshChild } from '../../../src/main/capture/spawn'

describe('spawnSshChild', () => {
  it('spawns a killable child and reports its exit', async () => {
    // `node -e ""` stands in for ssh: it exits immediately and needs no network.
    const child = spawnSshChild(['-e', ''], 'node')
    const exited = new Promise<void>((resolve) => child.onExit(() => resolve()))
    await exited
    expect(() => child.kill()).not.toThrow()
  })

  it('kill() is safe to call twice', () => {
    const child = spawnSshChild(['-e', 'setTimeout(()=>{},10000)'], 'node')
    child.kill()
    expect(() => child.kill()).not.toThrow()
  })
})
```

Create `tests/main/ipc-capture-lifecycle.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'

describe('capture lifecycle wiring', () => {
  it('feeds running instance names to the capture session on each list', async () => {
    const onRunningInstances = vi.fn()
    const adapter = {
      listSandboxes: vi.fn(async () => [
        { name: 'a', status: 'running', agent: 'claude', workspace: '', createdAt: '' },
        { name: 'b', status: 'stopped', agent: 'claude', workspace: '', createdAt: '' }
      ])
    }
    // `instances:list` runs the real reconciler, so this fake must satisfy everything
    // reconcile() calls — it touches more store methods than are obvious, and a missing one
    // surfaces as a confusing TypeError rather than a useful assertion. The fake below is
    // complete as written; check it against src/main/reconciler.ts if that changes.
    // (Note: tests/main/reconciler.test.ts is NOT a source for this — it uses a real
    // openStore(':memory:'), not an object fake.)
    const store = {
      listInstanceMeta: () => [], listInstanceTags: () => new Map<string, string[]>(),
      deleteInstanceMeta: vi.fn(), deleteInstanceTags: vi.fn(), listDefinitions: () => [],
      getDefinition: () => null, upsertInstanceMeta: vi.fn(), setInstanceTags: vi.fn(),
      updateInstanceFingerprint: vi.fn(), getDefinitionSpec: () => null
    }
    const h = buildHandlers({
      adapter, store, probes: {}, openTerminal: vi.fn(),
      capture: { status: vi.fn(), enable: vi.fn(), disable: vi.fn(), onRunningInstances }
    } as never)

    await h['instances:list']()
    expect(onRunningInstances).toHaveBeenCalledWith(['a'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/capture/spawn.test.ts tests/main/ipc-capture-lifecycle.test.ts`
Expected: FAIL — `spawn.ts` missing; `onRunningInstances` never called.

- [ ] **Step 3: Write the spawn adapter**

Create `src/main/capture/spawn.ts`:

```typescript
import { spawn } from 'node:child_process'
import type { CaptureChild } from './session'

/**
 * Spawn the supervised ssh child that holds the `-L` forward and carries the relay command.
 *
 * The app holds this PID, so teardown is a direct kill — no process-matching by command line
 * is ever needed. (`cmd` is injectable purely so the test can substitute a trivial process.)
 */
export function spawnSshChild(args: string[], cmd = 'ssh'): CaptureChild {
  const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true })
  let dead = false
  child.on('exit', () => { dead = true })
  // A spawn failure (no ssh on PATH) must not crash the main process; the session's
  // listener probe will fail and report the phase instead.
  child.on('error', () => { dead = true })
  return {
    kill: () => { if (!dead) { try { child.kill() } catch { /* already gone */ } } },
    onExit: (cb) => { child.on('exit', cb); child.on('error', cb) }
  }
}
```

- [ ] **Step 4: Feed running instances to the session**

In `src/main/ipc.ts`, inside the `'instances:list'` handler, after the instance views are computed and before returning them, add:

```typescript
      deps.capture?.onRunningInstances(views.filter((v) => v.status === 'running').map((v) => v.name))
```

(If the local variable holding the reconciled views is not named `views`, use whatever name it has — it is the array the handler returns.)

- [ ] **Step 5: Construct and wire the session in main**

In `src/main/index.ts`, add the imports:

```typescript
import { createCaptureSession } from './capture/session'
import { spawnSshChild } from './capture/spawn'
import { readBurpSettings } from './capture/settings'
import { readCaFile } from './capture/ca'
import { tcpProbe } from './capture/verify'
```

Build the session just before the `registerIpc` call:

```typescript
  const capture = createCaptureSession({
    exec: (sandbox, script) => adapter.execScript(sandbox, script),
    execCapture: (sandbox, script) => adapter.execCapture(sandbox, script),
    settings: () => readBurpSettings(store),
    readCa: readCaFile,
    spawnSsh: spawnSshChild,
    probe: (port) => tcpProbe(port),
    log: logger
  })
```

Pass it into `registerIpc` by adding `capture` to the existing options object.

Tear capture down on quit — the design is explicit that capture never survives the app:

```typescript
  app.on('before-quit', () => { void capture.disable() })
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/main/capture/spawn.ts src/main/index.ts src/main/ipc.ts tests/main/capture/spawn.test.ts tests/main/ipc-capture-lifecycle.test.ts
git commit -m "feat(capture): wire session into app lifecycle with teardown on quit"
```

---

## Manual verification

Automated tests cover none of the real transport by design — they use fakes. After Task 10, verify against a live sandbox and a running Burp:

1. Start Burp. In Settings, set the CA path (confirm the subject/expiry line appears) and export the Burp config; import it via Burp → Settings → User settings → Import.
2. Open a running sandbox → Monitoring → Enable. Expect the phases to advance and the card to land on **Capturing via Burp** with `12/12` and a credential tick.
3. In a **new** shell: `curl -v https://example.com` should present a `PortSwigger CA` issuer, and `claude -p "say hi"` should answer normally while its requests appear in Burp's HTTP history.
4. Disable. Confirm `http_proxy` in a new shell reverts to `http://gateway.docker.internal:3128`, `/tmp/burp-proxy-port` is gone, and `claude -p` still answers.
5. Quit the app while capturing; confirm no `ssh` process remains holding the upstream port.
