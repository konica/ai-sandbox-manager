# Cross-Platform App Distribution — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorming)

## Goal

Let an end user install and run AI Sandbox Manager on macOS, Windows, and Linux
from a downloadable installer, without building from source. `git tag vX.Y.Z &&
git push --tags` produces installers on CI and attaches them to a GitHub Release.

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Packaging tool | **electron-builder** (already installed; the documented companion to electron-vite — no pipeline change) |
| Code signing | **Unsigned now, signing-ready.** Config structured so signing turns on later via CI secrets only |
| Targets | macOS **dmg** (arm64 + x64), Windows **NSIS** (x64), Linux **AppImage** (x64) |
| Build host | **GitHub Actions matrix** on native runners |
| Auto-update | **Manual re-download now.** CI publishes `electron-updater` metadata (`latest*.yml`) so in-app updates can switch on later with no re-release |

## Architecture

Front half of the pipeline is unchanged: `electron-vite build` → `out/`. A new
step, `electron-builder`, packages `out/` plus production `node_modules` into
per-OS installers under `dist/`. Package `main` is already `out/main/index.js`
(ESM; Electron 33.4.11 supports ESM main). The preload is emitted as `.cjs`.

### The native-module crux: `better-sqlite3`

`better-sqlite3` is a compiled native module and the only real distribution
risk. Two failure modes, each addressed:

1. **ABI mismatch** (built for Node, not Electron) → crash on launch.
   electron-builder's default `npmRebuild` recompiles native deps against the
   bundled Electron during packaging. Each CI job builds on its own native
   runner, so the binary always matches the target OS/arch. The repo's
   `scripts/ensure-abi.mjs` (Node↔Electron flipping for dev/test) is wired only
   to `predev`/`pretest`, never to packaging, so it cannot interfere.

2. **Packed inside asar** (can't `dlopen` a `.node` from an archive) →
   module-not-found. `asarUnpack: "**/better-sqlite3/**"` places the `.node` in
   `app.asar.unpacked/` on disk.

### macOS dual-arch

To avoid fragile x64-on-arm native cross-compiling, CI runs **two mac jobs**:
`macos-14` (Apple Silicon) → arm64 dmg, `macos-13` (Intel) → x64 dmg. Each
compiles `better-sqlite3` natively.

### Not bundled

Docker and the `sbx` CLI stay external — the app's existing prereq-check screen
already guides users to install them. Distribution only documents the
prerequisite.

## Components

- **`electron-builder.yml`** — packaging config (appId, productName, files,
  `asarUnpack`, per-OS target blocks, `publish: github`).
- **`build/icon.png`** — committed 1024×1024 source icon (padded from the wide
  `mgm-logo-light.png`, 1202×430, via `sips`). electron-builder auto-generates
  `.icns`/`.ico`/Linux png from it.
- **`src/main/smoke.ts`** — `runSmoke(): boolean`; opens an in-memory
  better-sqlite3 DB and runs a query. Exercises the real native binary.
- **`src/main/index.ts`** — env-guarded smoke branch: when `SBX_SMOKE_TEST` is
  set, run `runSmoke()` and `app.exit(0|1)` before opening a window.
- **`scripts/smoke.mjs`** — spawns the packaged binary in `dist/` with
  `SBX_SMOKE_TEST=1` and asserts exit 0 (Linux under `xvfb-run`).
- **`.github/workflows/build-check.yml`** — PR gate: typecheck, unit tests,
  unpacked build + smoke on Ubuntu.
- **`.github/workflows/release.yml`** — tag-triggered matrix (macos-14,
  macos-13, windows-latest, ubuntu-latest): build, smoke, publish to a **draft**
  GitHub Release.
- **`docs/INSTALL.md`** — end-user install steps per OS, unsigned-app
  workarounds, Docker + sbx prerequisite.

## Verification strategy

A packaged app that fails only because the native module didn't load is
invisible to unit tests, so the smoke test is the key gate:

- **Unit test** (`tests/main/smoke.test.ts`) covers `runSmoke()` on the Node ABI.
- **Packaged smoke test** in CI runs the real installer's unpacked binary on
  each OS, catching ABI mismatch and asar-unpack mistakes.
- **PR build-check** builds an unpacked app on Ubuntu so packaging breakage is
  caught before release.

## CI release flow

On `v*` tag push, four jobs build in parallel and publish to one **draft**
release (`publish: github`, default draft). `--publish always` uploads
installers *and* `latest*.yml` update metadata. The smoke step runs as a
required job step, so a failure turns the job red — a signal not to publish the
draft. Releases stay draft until a human clicks Publish.

## Out of scope (deferred, structured for)

- Code signing / notarization (add CI secrets later; config already leaves
  identity unset so builds are unsigned-clean).
- In-app auto-update (metadata is published now; wire `electron-updater` later).
- Windows portable / Linux deb+rpm / macOS zip targets.
