# Burp Traffic Capture — Design

**Date:** 2026-08-24
**Status:** Approved, ready for planning

## Problem

AI Sandbox Manager can already show *which hosts* a sandbox talked to — the Monitoring
tab renders `sbx policy log` as allowed/blocked hosts with proxy types. It cannot show
*what was actually sent*: no headers, no bodies, no responses. Inspecting an agent's real
HTTP traffic means dropping to a hand-rolled toolkit of shell scripts outside the app.

A working spike exists at `~/.sbx-burp`. It routes a sandbox's traffic through Burp Suite
on the host without breaking sbx's credential injection. This design brings that
capability into the app as a per-sandbox toggle.

## The one constraint that dictates the design

A sandbox does not hold its own credentials. Inside it, `GH_TOKEN` is the placeholder
`gho_sbxproxymanaged000...`; the sbx runtime maps `api.anthropic.com`, `api.github.com`
and `claude.ai` to an `AuthConfig` that injects the real secrets **at the sbx proxy**
(`gateway.docker.internal:3128`).

| request | result |
|---|---|
| `api.github.com` via the sbx proxy | `200` |
| `api.github.com` bypassing it | `401` |

So Burp must be inserted *in front of* the sbx proxy and must **chain back into it**.
Simply repointing the sandbox at Burp silently breaks GitHub and Anthropic auth. Every
structural decision below follows from this.

## Goal

Toggle traffic capture on one running sandbox from the app. When it is on, requests from
newly-started processes in that sandbox are visible in Burp, TLS is intercepted with a
trusted CA, and credential injection still works.

## Non-goals

Carried over from the spike as documented limitations, not defects to fix here:

- **The already-running agent is not captured.** It keeps the environment it booted with.
  Capturing it would mean editing sandboxd's `ProxyEnvVars` state file and restarting the
  sandbox — killing the live session, and risking a sandbox with no egress if the tunnel
  is down at boot. New shells are captured; the UI says so plainly.
- **Post-injection traffic is not visible.** Captured `Authorization` headers show the
  placeholder token, because the real one is added downstream at the sbx proxy. sbx has no
  upstream-proxy setting and its `3128` is not a host listener, so Burp cannot be placed
  after it.
- **Proxy-aware clients only.** Anything deliberately ignoring `http_proxy` bypasses Burp.
  Transparent interception would need an iptables REDIRECT inside the sandbox plus a
  second Burp listener with invisible proxying.
- **Java** picks up `JAVA_TOOL_OPTIONS` but will not trust the Burp CA until it is
  imported into the JVM `cacerts` keystore.
- **No multi-sandbox capture.** See "One at a time" below.

## Spike verification (2026-08-24)

The spike was re-run end to end against sandbox `ai-agents-on-aws-87532231` with Burp
Suite listening on `127.0.0.1:8080`. All checks passed:

```
Burp listener on 127.0.0.1:8080: OK
Burp CA present in sandbox trust store
upstream chain (Burp -> sbx proxy) -> 200
12 concurrent requests -> 12/12 succeeded
credential injection (api.github.com) -> 200
```

Interception was confirmed to be genuine rather than a passing status code. From inside
the sandbox, `https://example.com` through the capture port presents `CN=example.com`
**issued by `PortSwigger CA`**; the same request through the stock sbx proxy presents
`Cloudflare TLS Issuing ECC CA 3`. `curl` validated the chain without `-k`, proving the CA
install reaches the trust store that `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` and
`NODE_EXTRA_CA_CERTS` all point at.

### The Anthropic API path

`api.anthropic.com` is the host that matters most — it is what the agent actually talks to,
and it is credential-injected, so it exercises the Burp-chains-back-into-the-sbx-proxy
requirement rather than merely proving egress. Tested directly:

- Through the capture port, `POST /v1/messages` presents `CN=api.anthropic.com` **issued by
  `PortSwigger CA`** — Burp terminates the TLS and sees the plaintext request.
- The same request returns **`HTTP 200`** with a genuine model completion. The sandbox
  carries no Anthropic credential of its own (`SBX_CRED_ANTHROPIC_MODE=none`); the account
  is `(oauth configured)` at global scope and injected at the sbx proxy. A `200` is
  therefore only reachable if injection survived the detour — a broken chain returns `401`.

An earlier attempt with a wrong model name returned a `not_found_error` carrying a real
`request_id`, which is itself the same proof: model validation happens after
authentication, so a `404` on the model already rules out an auth failure.

### Claude Code itself is captured

Curl proves the transport; it does not prove the *agent* is captured. Claude Code is the
actual target, it ships here as a native ELF binary (v2.1.241), and an HTTP client that
ignores `http_proxy` is a real and common failure mode — Node's `fetch`/undici does exactly
that by default. So this was tested directly rather than assumed.

With capture on, `claude -p` in a login shell exited `0` and returned the expected answer,
while `/proc/net/tcp` showed:

- **33 distinct TCP connections to `127.0.0.1:18080`**, the capture port
- **zero** connections to `:443` on any non-loopback address

Claude Code therefore honours `http_proxy`/`https_proxy` for all of its traffic, with no
bypass, and trusts the Burp CA via `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt`.
With capture off it works identically through the stock sbx proxy.

Those 33 concurrent connections are also independent justification for keeping the
12-concurrent verification check: this is precisely the load profile that collapsed the
original `-R` transport.

### sbx performs its own TLS interception

Worth recording because it is easy to misread while debugging. Requests through the stock
sbx proxy present `CN=Docker Sandboxes Proxy CA` **for credential-injected hosts only**
(`api.anthropic.com` does; `example.com` shows the genuine Cloudflare issuer). sbx must
MITM those hosts in order to substitute the real secret for the placeholder.

With capture on there are therefore *two* interception layers on those hosts: Burp first,
then sbx. This is the mechanism behind the "Burp sees pre-injection requests" limitation —
Burp is upstream of the substitution, so it observes the placeholder token, and the real
credential is attached afterwards at a layer Burp never sees.

### Disable restores normal operation

The disable path was verified explicitly, since the whole design leans on it as the safety
property. After tearing capture down:

| check | result |
|---|---|
| `http_proxy` in a new login shell | reverted to `http://gateway.docker.internal:3128` (stock sbx proxy) |
| `/tmp/burp-proxy-port` | removed |
| `socat` relays in the sandbox | none running |
| host listeners on `3128` / `3129` | none |
| `https://example.com` | `200` |
| `api.github.com` with `GH_TOKEN` | `200` — credential injection intact |
| `api.anthropic.com` `POST /v1/messages` | `200` with a genuine completion |
| `claude -p` in a new shell | exit `0`, expected answer, zero connections to the capture port |
| TLS issuer on `example.com` | back to `Cloudflare TLS Issuing ECC CA 3`, no PortSwigger |

The only sockets remaining on the capture port after teardown were in `TIME_WAIT`; no
listener, no established connection, no `socat` process, and the port file removed.

Egress never lapsed at any point. The profile script self-disables when the port file is
gone, so the sandbox falls back to its own proxy rather than losing connectivity.

## Architecture

```
sandbox process  --http_proxy-->  127.0.0.1:18080          socat, in sandbox
   -> sbx proxy CONNECT 127.0.0.1:8080    sandboxd is a host process, so this is host loopback
   -> Burp 127.0.0.1:8080                 <-- requests visible here
   -> upstream 127.0.0.1:3128             ssh -L, on host
   -> 127.0.0.1:3129                      socat, in sandbox
   -> gateway.docker.internal:3128        sbx proxy: credential injection + policy
   -> internet
```

### Why each hop exists

Each hop was probed for deletion on 2026-08-24. All three survive:

- **The `:18080` inbound relay.** Burp is not reachable from the sandbox by address.
  `gateway.docker.internal:8080` answers a `400` CONNECT (the request NATs out rather than
  reaching host loopback), and `host.docker.internal`, `localhost` and `127.0.0.1` all
  fail outright. The sbx proxy *will* however `CONNECT` to `127.0.0.1:8080` on behalf of
  the sandbox, which is host loopback because sandboxd is a host process. socat's `PROXY:`
  address performs exactly that chaining; `http_proxy` alone cannot express a
  proxy-to-proxy chain, so the relay is required.
- **The `:3129` outbound relay.** `ssh -L 3128:gateway.docker.internal:3128` is rejected by
  sbx's SSH server with `administratively prohibited: only loopback forwarding is
  permitted`, so `-L` cannot target the gateway directly and needs a loopback hop.
- **The `ssh -L` leg itself.** Burp is a host process and must reach a service that only
  exists on the sandbox network. See "Rejected alternatives".

### Host side vs sandbox side

Work splits by capability, not by habit.

**`sbx exec`** — via the existing, tested `SbxAdapter.execScript` / `execCapture` — does
everything that is not a port forward: the `socat` presence probe, the CA install, the
`/etc/profile.d` write, the in-sandbox verification requests, and teardown. Both
prerequisites were confirmed on the live sandbox: `socat` is at `/usr/bin/socat`, and
`sudo -n` succeeds.

**One `ssh <name>.sbx` child process** does the only thing `sbx exec` cannot: hold
`-L 3128:127.0.0.1:3129`. The two `socat` relays ride as that session's remote command, so
killing the child tears down the entire apparatus. `sbx` already manages a generic
`Host *.sbx` block with a `ProxyCommand` in `~/.ssh/config`, so this works for any sandbox
with no per-sandbox setup.

Since the final topology uses no `-R`, two spike artifacts disappear:

- **`kill-tunnels.ps1` is deleted.** It matched ssh processes on their forward specs only
  because the spike backgrounded them with `nohup` and lost the handle. The app spawns the
  child and holds its PID, so it kills by PID. (Observed while probing: a stray ssh ignored
  Git Bash `pkill` entirely but died instantly to kill-by-PID.)
- **The leaked-forward-port candidate loop is deleted.** The `18080 18090 18091 …` search
  existed because sbx's SSH server leaks *reverse* forward ports. Local forwards do not
  have this failure mode.

**Node, not `openssl`, converts the CA.** `new X509Certificate(buf).toString()` accepts
both DER and PEM and emits PEM. Verified against the real `burp.cer`. This removes a
dependency on a Git-Bash-provided binary.

### One at a time

Burp has a single upstream-proxy rule pointing at one host port, so exactly one sandbox can
be captured at a time. The session manager enforces this rather than letting a second
Enable silently fight the first for port `3128`.

## Rejected alternatives

**Replacing `ssh -L` with a Node bridge over `sbx exec`.** A host TCP listener that spawns
`sbx exec <name> socat STDIO TCP6:gateway.docker.internal:3128` per connection would remove
the `ssh` dependency entirely and route everything through the one CLI the app already
wraps. It was built and measured: functionally correct (12/12 requests returned `200`), but
first-byte latency was **397 ms** for a single connection and degraded to **2.7 s at 12
concurrent connections**, because every connection pays for its own container exec.
`ssh -L` multiplexes one persistent channel. Recorded here so the trade is not
re-litigated; revisit only if the ssh config block ever stops being managed by sbx.

**Placing Burp downstream of the sbx proxy.** Would capture post-injection traffic, but sbx
exposes no upstream-proxy setting and its `3128` is not a host listener.

**Setting `http_proxy` per shell instead of a profile script.** The app builds its own
shell commands and could inject the proxy env there. Rejected: it would miss shells opened
outside the app (VS Code terminals, plain `ssh`), and it would lose the profile script's
self-disabling property. The profile script activates only while the listener is genuinely
up, so a dead tunnel degrades to the stock sbx proxy instead of killing egress — a safety
property worth ~20 lines.

## Module layout

Small, single-purpose modules following patterns the repo already uses:
`sbx/fs-probe.ts` for script builders, `sbx/policy-log.ts` for output parsers.

| module | responsibility | shape |
|---|---|---|
| `shared/capture.ts` | `BurpSettings`, `CaptureState`, `CapturePhase`, `CaptureCheck`, `CaptureStatus`, port constants | pure types + constants |
| `main/capture/scripts.ts` | builds in-sandbox scripts: socat probe, CA install, profile write, relay command, verification, teardown | pure string builders |
| `main/capture/verify.ts` | parses verification stdout into typed checks | pure parser |
| `main/capture/ca.ts` | CA file → PEM + subject/expiry for UI feedback | one fs read |
| `main/capture/settings.ts` | Burp settings over the existing `app_prefs` store, with defaults | pure over `{get,set}` |
| `main/capture/burp-config.ts` | builds the Burp user-config JSON for the upstream rule | pure |
| `main/capture/session.ts` | the only stateful piece: spawn/track/kill the ssh child, drive the phases, hold the single active session | injectable adapter + spawn |

Everything except `session.ts` is pure and directly unit-testable.

## Global settings

A new **Traffic capture (Burp)** card on the Settings screen, beside Default Tier and
Credential Storage.

Two fields, because only two genuinely vary:

- **Burp CA certificate** — file path with a picker. Only the *path* is stored, so
  regenerating the CA inside Burp needs no re-import. On save the app parses the file and
  confirms with the subject and expiry (`PortSwigger CA · expires 2030-08-24`), or shows a
  plain parse error.
- **Burp proxy port** — default `8080`.

Under an **Advanced** disclosure, one field:

- **Upstream port** — default `3128`. Configurable because Burp's own config references it
  by number, so it must stay stable and known.

The two in-sandbox ports (`3129` relay, `18080` app port) are **constants with automatic
fallback** when occupied. Nothing outside the sandbox references them: the profile script
already reads the chosen app port from `/tmp/burp-proxy-port`, so dynamic selection costs
nothing and removes a class of collision failures rather than exposing it as a setting.

Occupancy is decided inside the sandbox during preflight, by the same `/proc/net/tcp`
state-`0A` scan the profile script uses — not by attempting a bind and interpreting the
error. Each port walks its own candidate list (`3129, 3130, …` and `18080, 18081, …`,
eight attempts each) and the first free candidate wins. Exhausting a list is a preflight
failure naming the port, not a silent fallback to a busy one.

All keys live in the existing `app_prefs` table (`burp.caPath`, `burp.proxyPort`,
`burp.upstreamPort`). **No schema migration.**

## Burp upstream rule: export, don't document

The upstream rule is the single most fragile human step in the whole flow. Without it Burp
goes straight to the internet and every authenticated call from the sandbox returns `401` —
a failure that looks like broken credentials, not broken proxy config.

Rather than printing instructions for a five-field form, the settings card offers **Export
Burp config** (save to file) and **Copy**, emitting:

```json
{
  "user_options": {
    "connections": {
      "upstream_proxy": {
        "servers": [
          {
            "destination_host": "*",
            "enabled": true,
            "proxy_host": "127.0.0.1",
            "proxy_port": 3128
          }
        ]
      }
    }
  }
}
```

`proxy_port` is filled from the configured upstream port. The shape was read from a working
Burp installation (`%APPDATA%/BurpSuite/UserConfig.json`) rather than guessed.

Two properties make this worth doing: it is **user** options, not project options, so it
persists across every Burp project and is imported exactly once (Settings → User settings →
Import); and it eliminates transcription errors on the one setting whose failure mode is
misleading.

The app cannot push config into a running Burp — that would need the Pro REST API — so the
import itself stays a manual one-click step, and the card states plainly that Burp must be
restarted or the settings re-imported for it to take effect.

## Session lifecycle

State: `off → starting → on`, or `→ error`. Phases run in order and each is surfaced live
in the capture card:

1. **preflight** — Burp listening on the configured host port; sandbox running; `socat`
   present in the sandbox; a CA path configured and parseable
2. **ca** — install to `/usr/local/share/ca-certificates/burp.crt`, then
   `update-ca-certificates`. Idempotent, and re-run on every enable because a sandbox
   rebuild wipes it
3. **profile** — write `/etc/profile.d/burp-proxy.sh` (the spike's POSIX-sh version:
   `/bin/sh` is dash and has no `/dev/tcp`, so liveness is checked by matching state `0A`
   — LISTEN — in `/proc/net/tcp`). **The `0A`-only match is load-bearing, not fussiness.**
   Measured immediately after a teardown: the capture port held 20 sockets in state `06`
   (`TIME_WAIT`) and no listener. A looser match would have read those as a live tunnel and
   kept exporting `http_proxy` to a dead relay — turning a clean fallback into an egress
   outage. Any reimplementation must preserve the exact state comparison.
4. **tunnel** — spawn the `ssh` child, wait for the local listener to actually appear
5. **verify** — upstream chain → `200`; 12 concurrent requests → `12/12`; credential
   injection → `200`

The concurrency check is retained deliberately. It is the check that caught the original
`-R` transport, which passed a single request and then collapsed (12 parallel requests: 4
succeeded, listener gone).

**How teardown is triggered.** Toggle-off and app quit are direct calls (the latter from
the existing `before-quit` path). Sandbox stop and rebuild are *observed*, not signalled:
the app's existing reconciler already polls the instance list, so the session manager
subscribes to that and tears down when its sandbox stops appearing as running. This adds no
new polling. A sandbox that dies while capturing therefore converges to Off within one
reconciler tick rather than showing a live session against a dead container.

**Teardown** — on toggle off, sandbox stop or rebuild, and app quit: kill the ssh child,
then `sbx exec` a cleanup that `pkill`s the two relays and removes `/tmp/burp-proxy-port`.
Killing the child normally takes the relays with it; the explicit `pkill` is belt-and-braces,
since sbx's SSH server is a custom Go implementation whose signal propagation is not
guaranteed. Removing the port file is what makes new shells fall back to the stock sbx
proxy, so **egress never breaks**.

**No persistence, no auto-resume.** Quitting the app always tears capture down. On next
launch the card reads Off. The toggle means "capturing right now" and never a stale promise,
and the app never silently begins intercepting traffic.

## IPC surface

Following the existing `ipcMain.handle` + preload + `api` client pattern:

| channel | purpose |
|---|---|
| `capture:status` | current `CaptureStatus` (global — one session at a time) |
| `capture:enable` | start capture on a named sandbox |
| `capture:disable` | tear down the active session |
| `capture:settingsGet` / `capture:settingsSet` | Burp settings |
| `capture:caInspect` | parse the CA at a path → subject/expiry or error |
| `capture:burpConfig` | the export JSON above |

`CaptureStatus` is one object carrying `sandbox`, `state`, current `phase`, the check
results, and an error message — so the card renders from a single value.

The status is **global, not per-instance**, because only one session exists. A capture card
therefore renders its own instance's state by comparing `status.sandbox` to the instance it
is mounted on: equal means this sandbox's live state, different means "another sandbox is
capturing" (which is what disables Enable and names the occupant), and `null` means idle.
The card polls `capture:status` on the same interval the Monitoring tab already uses for
the policy log, so no new push channel is introduced.

## UI: capture card on the Monitoring tab

Monitoring already owns "what is this sandbox talking to". The capture card sits above the
existing network activity list, deepening it rather than competing with it.

```
┌─ Traffic capture ─────────────────────────┐
│ ● Capturing via Burp   [ Disable ]        │
│ Burp 127.0.0.1:8080 · upstream :3128      │
│ ✓ CA installed  ✓ chain 200  ✓ 12/12      │
│ ⚠ running agent not captured — open a     │
│   new shell or restart it  [Open shell]   │
└───────────────────────────────────────────┘
```

States:

- **Off** — Enable button. Disabled with a stated reason when the sandbox is stopped, when
  no CA is configured (linking to Settings), or when another sandbox is already capturing
  (naming it).
- **Starting** — per-phase progress, so a hang is attributable.
- **On** — as drawn. The "running agent not captured" line is persistent, not dismissible,
  and its button reuses `InstanceDetail`'s existing `onShell` handler.
- **Error** — which phase failed and what to do about it.

## Error handling

**Fail closed on a broken credential chain.** If verification shows Burp is not chaining
back into the sbx proxy, the tunnel comes down automatically instead of being left up. A
half-working capture that silently `401`s the agent is worse than no capture at all. The
error state shows the Burp config export and an explicit **Enable anyway** action that
re-runs while skipping that gate, for sandboxes where credential injection does not matter.

**Enable anyway is per-attempt and never remembered.** It is not a setting and not sticky
across sessions: the next Enable starts from the fail-closed default again. A one-click
override of a safety gate that silently persists would be worse than no gate, because the
`401`s it permits look like broken credentials.

**The credential check probes Anthropic first, GitHub second.** The check has to use a host
whose credential is injected at the sbx proxy, because that is the only way to tell a
working chain from Burp going direct.

1. **`GET https://api.anthropic.com/v1/models`** is the primary probe. It is the agent's own
   API and is configured in every sandbox this app targets; it authenticates purely by
   injection, needs no request body, and **spends no tokens**. Verified returning `200`.
2. **`api.github.com` with `$GH_TOKEN`** is the fallback, used when the Anthropic
   credential is absent.
3. **Neither configured** — the card states plainly that the upstream rule could not be
   verified, shows the config export, and enables with a warning rather than a false green
   tick.

The spike used the GitHub probe alone; demoting it to fallback removes the case where a
sandbox with no GitHub credential produces a meaningless failure. Note that a `4xx` which
is *not* `401` still proves the chain works — authentication precedes request validation,
so only `401` indicates a broken chain.

**Every failure names its phase.** "Burp not listening on 127.0.0.1:8080" and "socat not
found in this sandbox" are different problems with different fixes, and the card says which
one happened.

## Testing

`npm run typecheck` and `npm test` must pass before this is complete.

- **Pure modules** (`scripts`, `verify`, `ca`, `settings`, `burp-config`) — unit-tested
  directly. Script builders assert on generated text; `verify` gets fixture stdout for
  healthy, partial and malformed cases; `burp-config` asserts the exact JSON shape recorded
  above.
- **`session.ts`** — tested with an injected fake adapter and fake spawn: full phase
  ordering, the one-at-a-time guard, fail-closed teardown on a failed credential check, all
  three branches of the credential probe (Anthropic, GitHub fallback, neither configured),
  the non-`401` `4xx` case that must still count as a pass, idempotent disable, and teardown
  on sandbox stop. No Burp, no ssh and no sandbox required.
- **Renderer** — testing-library over the card's four states and the settings card,
  including the disabled-Enable reasons.
- **i18n** — every new string added to both `i18n/en.ts` and `i18n/de.ts`.

## Platform

The implementation is platform-neutral: dropping `kill-tunnels.ps1` and `openssl` leaves
nothing Windows-specific. The topology depends on sandboxd being a host process so that the
sbx proxy's `CONNECT 127.0.0.1:<burp>` lands on host loopback, which should also hold on
macOS, but **this design is verified on Windows only**. macOS verification is a follow-up,
not an assumption baked in here.
