import { mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { SbxAdapter } from '../sbx/adapter'
import { SANDBOX_CLAUDE_DIR } from '../sbx/translate'

export { SANDBOX_CLAUDE_DIR }

/**
 * What a rebuild carries over, as an explicit ALLOWLIST — never a denylist.
 *
 * `projects/<encoded-workspace-path>/<uuid>.jsonl` holds the conversation transcripts and is
 * what `claude --continue`/`--resume` actually reads; `todos/` holds per-session todo state.
 *
 * Everything else is deliberately excluded, and the exclusions matter: `.credentials.json`
 * would overwrite the fresh scoped credentials the new sandbox is launched with, `sessions/`
 * holds the sandbox's own shell-session keys (not conversations, despite the name), and
 * `daemon.*` is live state naming the sandbox we are about to delete.
 */
export const PRESERVED = ['projects', 'todos'] as const

export interface ArchiveDeps {
  adapter: Pick<SbxAdapter, 'probeSandboxPath' | 'copyFromSandbox'>
}

export interface CaptureOptions {
  sbxName: string
  definitionId: string
  /** Root the archives live under — the app's userData dir in production. */
  baseDir: string
  /** Clock for the archive's timestamp; injected in tests. */
  now?: () => Date
  /** How many archives to retain per definition (default 3). */
  keep?: number
}

/** How many archives a definition keeps before the oldest is pruned. */
export const DEFAULT_KEEP = 3

/**
 * Timestamp suffix making each capture distinct and lexically sortable. Colons are stripped
 * because Windows forbids them in path segments; the result still sorts oldest-first as text,
 * which is what the pruning below relies on.
 */
function stamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, '-')
}

/**
 * Drop all but the `keep` newest archives under one definition's root. Scoped to that root, so
 * one definition's rebuild history never prunes another's. Pruning is best-effort: a directory
 * held open by another process must not fail the capture that just succeeded.
 */
function prune(root: string, keep: number): void {
  let entries: string[]
  try {
    entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return
  }
  // Names end in the sortable timestamp written by stamp(), so plain sort is oldest-first.
  for (const name of entries.sort().slice(0, Math.max(0, entries.length - keep))) {
    try { rmSync(join(root, name), { recursive: true, force: true }) } catch { /* best-effort */ }
  }
}

/**
 * Copy a sandbox's Claude session data onto the host, returning the archive directory
 * (or null when the sandbox has no sessions to preserve).
 *
 * Throws when the transcripts exist but cannot be copied. That is deliberate and load-bearing:
 * a rebuild removes the sandbox, so callers must abort rather than destroy the only copy.
 *
 * Side effect worth knowing: `sbx cp` STARTS a stopped sandbox rather than failing (verified
 * against a live stopped sandbox — it reports "Sandbox … started successfully" and exits 0).
 * So capturing from a stopped instance works, but leaves it running.
 */
export async function captureSessions(deps: ArchiveDeps, opts: CaptureOptions): Promise<string | null> {
  const projects = `${SANDBOX_CLAUDE_DIR}/projects`
  // No transcripts yet (a never-used sandbox) is not a failure — the caller proceeds as before.
  if (await deps.adapter.probeSandboxPath(opts.sbxName, projects) !== 'dir') return null

  const root = join(opts.baseDir, 'session-archives', opts.definitionId)
  const at = (opts.now ?? (() => new Date()))()
  const dir = join(root, `${opts.sbxName}-${stamp(at)}`)
  mkdirSync(dir, { recursive: true })
  for (const sub of PRESERVED) {
    const src = `${SANDBOX_CLAUDE_DIR}/${sub}`
    // Only `projects` is required (checked above); the rest are best-effort extras.
    if (sub !== 'projects' && await deps.adapter.probeSandboxPath(opts.sbxName, src) !== 'dir') continue
    await deps.adapter.copyFromSandbox(opts.sbxName, src, dir)
  }
  prune(root, opts.keep ?? DEFAULT_KEEP)
  return dir
}
