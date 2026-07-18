// Ensure the better-sqlite3 native binary matches the requested ABI.
//
// This project runs tests on Node (Vitest) but the app on Electron, and
// better-sqlite3 is a single native module that can only match one ABI at a
// time. Switching means either an Electron rebuild (slow, ~20-30s) or fetching
// the Node prebuilt (fast). To avoid paying that on every `npm run dev` / `npm
// test`, we record the current ABI in a marker file and skip when it already
// matches.
//
// Usage: node scripts/ensure-abi.mjs <electron|node> [--force]
//   predev  -> ensure electron   pretest -> ensure node
// The marker lives under node_modules/ so a fresh `npm install` resets it.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const target = process.argv[2]
const force = process.argv.includes('--force')
if (target !== 'electron' && target !== 'node') {
  console.error('Usage: node scripts/ensure-abi.mjs <electron|node> [--force]')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const marker = resolve(root, 'node_modules', '.better-sqlite3-abi')
const binExt = process.platform === 'win32' ? '.cmd' : ''

let current = null
try { current = readFileSync(marker, 'utf8').trim() } catch { /* no marker yet */ }

if (!force && current === target) {
  console.log(`better-sqlite3 already on the ${target} ABI — skipping.`)
  process.exit(0)
}

let res
if (target === 'electron') {
  const bin = resolve(root, 'node_modules', '.bin', `electron-rebuild${binExt}`)
  res = spawnSync(bin, ['-f', '-w', 'better-sqlite3'], { cwd: root, stdio: 'inherit' })
} else {
  const pkgDir = resolve(root, 'node_modules', 'better-sqlite3')
  const bin = resolve(root, 'node_modules', '.bin', `prebuild-install${binExt}`)
  res = spawnSync(bin, ['--runtime', 'node'], { cwd: pkgDir, stdio: 'inherit' })
}

if ((res.status ?? 0) !== 0) process.exit(res.status ?? 1)
writeFileSync(marker, target)
console.log(`better-sqlite3 switched to the ${target} ABI.`)
