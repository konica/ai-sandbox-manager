# Cross-Platform App Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce installable artifacts (macOS dmg arm64+x64, Windows NSIS x64, Linux AppImage x64) for AI Sandbox Manager via electron-builder, built and published on GitHub Actions on tag push.

**Architecture:** Keep the existing `electron-vite build` → `out/` step; add `electron-builder` to package `out/` + production `node_modules` into per-OS installers under `dist/`. The native module `better-sqlite3` is rebuilt for Electron by electron-builder and unpacked from asar. A smoke test launches the packaged app and exercises the native module to catch ABI/unpack failures. CI builds each OS on its own native runner.

**Tech Stack:** Electron 33.4.11 (ESM main), electron-vite 2.x, electron-builder 25.x, better-sqlite3 (native), GitHub Actions, Vitest.

## Global Constraints

- Packaging tool is **electron-builder** (already a devDependency `^25.1.8`). Do NOT introduce Electron Forge.
- Project is ESM (`"type": "module"`); scripts are `.mjs`, preload is `.cjs`.
- `appId`: `net.mgm-tp.ai-sandbox-manager`. `productName`: `AI Sandbox Manager`.
- Targets: macOS `dmg` (arm64, x64), Windows `nsis` (x64), Linux `AppImage` (x64). No other targets.
- Builds are **unsigned** but **signing-ready**: never set a signing identity/cert in committed config.
- `publish` provider is `github`; releases are **draft**.
- `dist/` is already in `.gitignore`; do NOT commit build output.
- Run tests with **`npm test`** (the `pretest` hook flips the better-sqlite3 ABI to Node). Never run bare `vitest`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Work on a branch off `main` (e.g. `feat/app-distribution`); do not commit distribution work directly to `main`.

---

## File Structure

- `build/icon.png` — committed 1024×1024 app icon source (electron-builder generates per-OS icons from it).
- `electron-builder.yml` — packaging configuration.
- `src/main/smoke.ts` — `runSmoke()`: opens an in-memory better-sqlite3 DB and runs a query; returns boolean.
- `src/main/index.ts` — add an `SBX_SMOKE_TEST` env-guarded branch that runs `runSmoke()` and exits.
- `scripts/smoke.mjs` — locates and launches the packaged binary with `SBX_SMOKE_TEST=1`, asserts exit 0.
- `tests/main/smoke.test.ts` — unit test for `runSmoke()`.
- `package.json` — add `dist`, `dist:dir`, `smoke` scripts.
- `.github/workflows/build-check.yml` — PR gate (typecheck, tests, unpacked build + smoke on Ubuntu).
- `.github/workflows/release.yml` — tag-triggered matrix build + draft publish.
- `docs/INSTALL.md` — end-user install instructions.

---

## Task 1: electron-builder config, app icon, and local build

**Files:**
- Create: `build/icon.png` (binary, generated via `sips`)
- Create: `electron-builder.yml`
- Modify: `package.json` (add `dist` and `dist:dir` scripts)

**Interfaces:**
- Produces: `npm run dist:dir` → an unpacked app under `dist/` that Task 3's smoke script launches. `electron-builder.yml` defines `appId: net.mgm-tp.ai-sandbox-manager`, `productName: AI Sandbox Manager`, output dir `dist`, buildResources dir `build`.

- [ ] **Step 1: Generate the square app icon from the wide logo**

The source logo `src/renderer/assets/mgm-logo-light.png` is 1202×430 (not square); electron-builder requires a square icon ≥512². Resize it to fit within an 820px box, then pad to a 1024×1024 white canvas (this is a one-time committed artifact, so macOS-only `sips` is fine):

```bash
mkdir -p build
# Resize longest side to 820px (keeps aspect ratio)
sips --resampleWidth 820 src/renderer/assets/mgm-logo-light.png --out build/icon.png
# Pad to a 1024x1024 white square (centers the logo)
sips -p 1024 1024 --padColor FFFFFF build/icon.png --out build/icon.png
```

- [ ] **Step 2: Verify the icon is square and visible**

```bash
sips -g pixelWidth -g pixelHeight build/icon.png
open build/icon.png
```
Expected: `pixelWidth: 1024` and `pixelHeight: 1024`. Visually confirm the logo is centered and legible on the white background. If the logo is a light color and invisible on white, re-run Step 1 with `--padColor 0D0D0D` instead.

- [ ] **Step 3: Write `electron-builder.yml`**

```yaml
appId: net.mgm-tp.ai-sandbox-manager
productName: AI Sandbox Manager
copyright: © mgm technology partners
directories:
  output: dist
  buildResources: build
files:
  - out/**
  - package.json
# better-sqlite3 is a native module: its .node must sit on disk, not inside asar.
asarUnpack:
  - "**/node_modules/better-sqlite3/**"
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
  category: public.app-category.developer-tools
  icon: build/icon.png
win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.png
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
linux:
  target:
    - target: AppImage
      arch: [x64]
  category: Development
  icon: build/icon.png
  # Pin the executable name so the unpacked binary is dist/linux-unpacked/ai-sandbox-manager
  # (default would be the spaced productName), matching scripts/smoke.mjs.
  executableName: ai-sandbox-manager
publish:
  provider: github
```

- [ ] **Step 4: Add build scripts to `package.json`**

In the `"scripts"` block, add these three entries (keep existing scripts unchanged):

```json
    "dist": "electron-vite build && electron-builder",
    "dist:dir": "electron-vite build && electron-builder --dir",
    "smoke": "node scripts/smoke.mjs"
```

- [ ] **Step 5: Build an unpacked app locally**

Run: `npm run dist:dir`
Expected: exits 0; produces `dist/mac-arm64/AI Sandbox Manager.app` (on Apple Silicon) or `dist/mac/AI Sandbox Manager.app`. electron-builder logs `rebuilding native dependencies dependencies=better-sqlite3@…`. If it complains the icon is not square, revisit Task 1 Steps 1–2.

- [ ] **Step 6: Launch the unpacked app to confirm it opens**

```bash
open "dist/mac-arm64/AI Sandbox Manager.app" 2>/dev/null || open "dist/mac/AI Sandbox Manager.app"
```
Expected: the app window opens without a "better-sqlite3 not found" or ABI error. Quit the app.

- [ ] **Step 7: Commit**

```bash
git add build/icon.png electron-builder.yml package.json
git commit -m "build: electron-builder config, app icon, and dist scripts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Smoke module + unit test

**Files:**
- Create: `src/main/smoke.ts`
- Create: `tests/main/smoke.test.ts`

**Interfaces:**
- Produces: `runSmoke(): boolean` (exported from `src/main/smoke.ts`) — returns `true` iff better-sqlite3 loads and executes a query. Consumed by `src/main/index.ts` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `tests/main/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runSmoke } from '../../src/main/smoke'

describe('runSmoke', () => {
  it('loads better-sqlite3 and round-trips a query', () => {
    expect(runSmoke()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- smoke`
Expected: FAIL — cannot find module `../../src/main/smoke`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/main/smoke.ts`:

```ts
import Database from 'better-sqlite3'

/**
 * Exercise the packaged native module end-to-end: open an in-memory SQLite
 * database and round-trip a value. Returns true iff better-sqlite3 loaded and
 * executed — the exact failure a packaged Electron app hits on an ABI mismatch
 * or an un-unpacked .node. Kept dependency-free of the app schema so it tests
 * only the native binary.
 */
export function runSmoke(): boolean {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE t (x INTEGER)')
    db.prepare('INSERT INTO t (x) VALUES (?)').run(42)
    const row = db.prepare('SELECT x FROM t').get() as { x: number } | undefined
    return row?.x === 42
  } finally {
    db.close()
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- smoke`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/main/smoke.ts tests/main/smoke.test.ts
git commit -m "feat(smoke): native-module smoke check (runSmoke)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire the smoke guard into main + packaged smoke runner

**Files:**
- Modify: `src/main/index.ts` (add import + env-guarded branch inside `app.whenReady().then(...)`)
- Create: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: `runSmoke()` from `src/main/smoke.ts` (Task 2).
- Produces: `npm run smoke` → exit 0 when the packaged app's native module works. Reads env var `SBX_SMOKE_TEST`.

- [ ] **Step 1: Add the `runSmoke` import to `src/main/index.ts`**

Add to the import block (after line 15, `import { writeKit } from './kit/write'`):

```ts
import { runSmoke } from './smoke'
```

- [ ] **Step 2: Add the smoke guard as the first statement inside `app.whenReady().then(...)`**

In `src/main/index.ts`, the block currently starts:

```ts
app.whenReady().then(() => {
  const store = openStore(join(app.getPath('userData'), 'sandbox-manager.db'))
```

Insert the guard immediately after the `app.whenReady().then(() => {` line, before `const store = …`:

```ts
app.whenReady().then(() => {
  // Packaged-app smoke test: when SBX_SMOKE_TEST is set, exercise the native
  // module and exit before opening a window. Used by scripts/smoke.mjs in CI.
  if (process.env.SBX_SMOKE_TEST) {
    const ok = runSmoke()
    console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL')
    app.exit(ok ? 0 : 1)
    return
  }
  const store = openStore(join(app.getPath('userData'), 'sandbox-manager.db'))
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no output (exit 0).

- [ ] **Step 4: Write `scripts/smoke.mjs`**

Create `scripts/smoke.mjs`:

```js
// Launch the packaged app with SBX_SMOKE_TEST=1 and assert it exits 0.
// electron-builder leaves an unpacked build in dist/ alongside the installer;
// we run that binary (built for the Electron ABI) — plain Node cannot load the
// unpacked .node, so the app itself must run it.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const APP = 'AI Sandbox Manager'

// Candidate paths to the packaged executable, by platform.
function candidates() {
  if (process.platform === 'darwin') {
    // dist/mac*, e.g. mac-arm64, mac-x64, or mac
    return readdirSync('dist')
      .filter((d) => d.startsWith('mac'))
      .map((d) => join('dist', d, `${APP}.app`, 'Contents', 'MacOS', APP))
  }
  if (process.platform === 'win32') {
    return [join('dist', 'win-unpacked', `${APP}.exe`)]
  }
  return [join('dist', 'linux-unpacked', 'ai-sandbox-manager')]
}

const exe = candidates().find((p) => existsSync(p))
if (!exe) {
  console.error(`smoke: no packaged executable found. Looked in:\n${candidates().join('\n')}`)
  process.exit(1)
}

console.log(`smoke: launching ${exe}`)
const res = spawnSync(exe, [], {
  env: { ...process.env, SBX_SMOKE_TEST: '1' },
  stdio: 'inherit',
  timeout: 60_000
})
if (res.status !== 0) {
  console.error(`smoke: FAILED (exit ${res.status}, signal ${res.signal})`)
  process.exit(1)
}
console.log('smoke: PASSED')
```

- [ ] **Step 5: Build and run the smoke test locally**

```bash
npm run dist:dir && npm run smoke
```
Expected: `SMOKE OK` from the app, then `smoke: PASSED`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts scripts/smoke.mjs
git commit -m "feat(smoke): SBX_SMOKE_TEST guard in main + packaged smoke runner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: PR build-check workflow

**Files:**
- Create: `.github/workflows/build-check.yml`

**Interfaces:**
- Consumes: `npm test`, `npm run typecheck`, `npm run dist:dir`, `npm run smoke` (Tasks 1–3).
- Produces: a CI gate that runs on PRs and pushes to `main`.

- [ ] **Step 1: Write `.github/workflows/build-check.yml`**

```yaml
name: build-check
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      # Build an unpacked app and smoke-test the native module under a virtual
      # display (Electron needs a display to reach app.whenReady on Linux).
      - run: npm run dist:dir
      - run: xvfb-run -a npm run smoke
```

- [ ] **Step 2: Validate the YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-check.yml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-check.yml
git commit -m "ci: PR build-check (typecheck, test, unpacked build + smoke)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Release workflow (matrix build + draft publish)

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `npm run dist` (Task 1), `npm run smoke` (Task 3), `electron-builder.yml` `publish: github` (Task 1).
- Produces: on `v*` tag push, installers + `latest*.yml` metadata attached to a draft GitHub Release.

- [ ] **Step 1: Write `.github/workflows/release.yml`**

Each job passes its platform+arch flags to electron-builder so a runner builds exactly one target. `GH_TOKEN` lets electron-builder publish; `contents: write` permission lets it create the release.

```yaml
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14
            builder_args: --mac --arm64
            smoke: gui
          - os: macos-13
            builder_args: --mac --x64
            smoke: gui
          - os: windows-latest
            builder_args: --win --x64
            smoke: gui
          - os: ubuntu-latest
            builder_args: --linux --x64
            smoke: xvfb
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Build renderer/main
        run: npm run build
      - name: Package + publish (draft)
        run: npx electron-builder ${{ matrix.builder_args }} --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Smoke (Linux)
        if: matrix.smoke == 'xvfb'
        run: xvfb-run -a npm run smoke
      - name: Smoke (macOS/Windows)
        if: matrix.smoke == 'gui'
        run: npm run smoke
```

- [ ] **Step 2: Validate the YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: release workflow (matrix build + draft GitHub Release)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: End-user install documentation

**Files:**
- Create: `docs/INSTALL.md`

**Interfaces:**
- Consumes: the target/format decisions and unsigned-build reality from the spec.
- Produces: user-facing install guidance (referenced from the GitHub Release notes).

- [ ] **Step 1: Write `docs/INSTALL.md`**

```markdown
# Installing AI Sandbox Manager

Download the installer for your OS from the
[latest release](https://github.com/konica/ai-sandbox-manager/releases/latest).

## Prerequisites

AI Sandbox Manager drives Docker Sandboxes; it does **not** bundle them. Before
first launch, install:

- **Docker Desktop** — https://www.docker.com/products/docker-desktop/
- **The `sbx` CLI** — https://docs.docker.com/ai/sandboxes/

The app's first-run screen checks for both and links you here if either is
missing.

## macOS

1. Download the `.dmg` for your chip (Apple Silicon = arm64, Intel = x64).
2. Open it and drag **AI Sandbox Manager** to Applications.
3. The build is not yet notarized, so the first launch is blocked. **Right-click
   the app → Open → Open**, or run:
   ```bash
   xattr -cr "/Applications/AI Sandbox Manager.app"
   ```

## Windows

1. Download and run the `.exe` (NSIS) installer.
2. SmartScreen may warn because the build is unsigned: click **More info → Run
   anyway**.
3. Follow the installer; the app installs per-user (no admin prompt).

## Linux

1. Download the `.AppImage`.
2. Make it executable and run it:
   ```bash
   chmod +x "AI Sandbox Manager-*.AppImage"
   ./"AI Sandbox Manager-*.AppImage"
   ```

## Updating

Download and install the newer version from the releases page; your data
(definitions, credentials, logs) lives under your user data directory and is
preserved across versions.
```

- [ ] **Step 2: Commit**

```bash
git add docs/INSTALL.md
git commit -m "docs: end-user install guide

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done criteria

- `npm run dist` produces a dmg (local, on macOS) with no ABI/asar errors.
- `npm run dist:dir && npm run smoke` prints `smoke: PASSED`.
- `npm test` and `npm run typecheck` are green.
- Both workflow YAML files parse.
- On a `v*` tag push, the release workflow builds all four targets and attaches
  installers + `latest*.yml` to a draft release.
- `docs/INSTALL.md` covers all three OSes and the unsigned-app workarounds.
