// Ensure the better-sqlite3 native binary matches the requested ABI.
//
// This project runs tests on Node (Vitest) but the app on Electron, and
// better-sqlite3 is a single native module that can only match one ABI at a
// time. Switching means an Electron rebuild (electron-rebuild) or restoring the
// Node prebuilt. To avoid paying that on every `npm run dev` / `npm test`, we
// record the current ABI in a marker file and skip when it already matches.
//
// Robustness notes (learned the hard way in this environment):
//  - The Node prebuilt is restored by extracting the cached prebuild tarball
//    from ~/.npm/_prebuilds (offline, reliable) rather than re-running
//    `prebuild-install`, whose network fetch is unreliable here. We fall back to
//    `prebuild-install` only if no matching cache tarball exists.
//  - After a Node switch we VERIFY the binary actually loads in a child node
//    process before writing the marker, so a silent no-op can never desync the
//    marker from reality (which would crash the test workers).
//
// Usage: node scripts/ensure-abi.mjs <electron|node> [--force]
//   predev -> ensure electron   pretest -> ensure node
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { homedir } from 'node:os'

const target = process.argv[2]
const force = process.argv.includes('--force')
if (target !== 'electron' && target !== 'node') {
  console.error('Usage: node scripts/ensure-abi.mjs <electron|node> [--force]')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const pkgDir = resolve(root, 'node_modules', 'better-sqlite3')
const marker = resolve(root, 'node_modules', '.better-sqlite3-abi')
const binExt = process.platform === 'win32' ? '.cmd' : ''

function readMarker() {
  try { return readFileSync(marker, 'utf8').trim() } catch { return null }
}

// Load the built binary in a fresh Node process. Exit 0 => matches Node ABI.
function nodeCanLoad() {
  const res = spawnSync(process.execPath, ['-e', "new (require('better-sqlite3'))(':memory:')"], { cwd: root, stdio: 'ignore' })
  return res.status === 0
}

// Newest cached prebuild tarball for this Node ABI, or null.
function cachedNodeTarball() {
  const abi = process.versions.modules // e.g. "147" on Node 26
  const needle = `-node-v${abi}-${process.platform}-${process.arch}.tar.gz`
  const dirs = [join(homedir(), '.npm', '_prebuilds'), join(homedir(), '.cache', 'prebuilds')]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const hit = readdirSync(dir).filter((f) => f.includes('better-sqlite3') && f.endsWith(needle)).sort()
    if (hit.length) return join(dir, hit[hit.length - 1])
  }
  return null
}

function switchToNode() {
  const tarball = cachedNodeTarball()
  if (tarball) {
    const res = spawnSync('tar', ['-xzf', tarball, '-C', pkgDir], { stdio: 'inherit' })
    if (res.status === 0 && nodeCanLoad()) return true
  }
  // Fallback: let prebuild-install fetch it (no --runtime flag: use the napi/default build).
  const bin = resolve(root, 'node_modules', '.bin', `prebuild-install${binExt}`)
  spawnSync(bin, [], { cwd: pkgDir, stdio: 'inherit' })
  return nodeCanLoad()
}

function switchToElectron() {
  const bin = resolve(root, 'node_modules', '.bin', `electron-rebuild${binExt}`)
  const res = spawnSync(bin, ['-f', '-w', 'better-sqlite3'], { cwd: root, stdio: 'inherit' })
  return (res.status ?? 1) === 0
}

if (!force && readMarker() === target) {
  console.log(`better-sqlite3 already on the ${target} ABI — skipping.`)
  process.exit(0)
}

const ok = target === 'node' ? switchToNode() : switchToElectron()
if (!ok) {
  console.error(`Failed to switch better-sqlite3 to the ${target} ABI.`)
  process.exit(1)
}
writeFileSync(marker, target)
console.log(`better-sqlite3 switched to the ${target} ABI.`)
