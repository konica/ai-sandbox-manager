// Restore the better-sqlite3 native binary to the Node ABI (for Vitest).
//
// This project runs tests on Node but the app on Electron, and better-sqlite3
// is a single native module that can only match one ABI at a time. `npm run dev`
// rebuilds it for Electron (see the `predev` hook); this script fetches the
// Node-ABI prebuilt back so `npm test` can load it.
//
// It is idempotent and fast (a prebuilt download, not a source compile), and a
// no-op-ish cost when the binary is already correct.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '..', 'node_modules', 'better-sqlite3')
const bin = resolve(here, '..', 'node_modules', '.bin', 'prebuild-install')

const res = spawnSync(bin, ['--runtime', 'node'], { cwd: pkgDir, stdio: 'inherit' })
process.exit(res.status ?? 0)
