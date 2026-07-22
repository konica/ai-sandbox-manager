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

// --no-sandbox: the smoke test only boots Electron to exercise the native module;
// on Linux CI, Chromium's setuid sandbox helper isn't root-owned in an unpacked
// build, so Electron aborts at startup without this. It affects only this test
// harness, never the shipped app.
console.log(`smoke: launching ${exe}`)
const res = spawnSync(exe, ['--no-sandbox'], {
  env: { ...process.env, SBX_SMOKE_TEST: '1' },
  stdio: 'inherit',
  timeout: 60_000
})
if (res.status !== 0) {
  console.error(`smoke: FAILED (exit ${res.status}, signal ${res.signal})`)
  process.exit(1)
}
console.log('smoke: PASSED')
