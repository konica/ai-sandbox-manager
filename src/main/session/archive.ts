import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { SbxAdapter } from '../sbx/adapter'
import type { Logger } from '../log'
import { SANDBOX_CLAUDE_DIR } from '../sbx/translate'
import type { ArchiveEntry } from '@shared/session'

export { SANDBOX_CLAUDE_DIR }

/** The archive file written into each archive directory. */
export const ARCHIVE_FILE = 'claude-backup.tgz'

/** Where the archive is staged inside the sandbox before being copied out. */
export const SANDBOX_TMP_ARCHIVE = `/tmp/${ARCHIVE_FILE}`

/**
 * Build the whole of ~/.claude into one compressed archive, inside the sandbox.
 *
 * One archive rather than per-entry copies: measured on a real sandbox (14M, 738 files) this
 * is faster than copying the tree and 2.4x smaller on disk. It also sidesteps the Windows
 * symlink failure entirely — tar STORES symlinks, where a host-side copy has to materialise
 * them and dies with "A required privilege is not held by the client".
 *
 * `sessions/` and `daemon.*` are excluded: both are live state naming the sandbox that is
 * about to be deleted. `--ignore-failed-read` is the skip-and-continue behaviour — one
 * unreadable file warns instead of costing the user everything else.
 */
export function archiveScript(): string {
  return `tar czf ${SANDBOX_TMP_ARCHIVE} -C ${SANDBOX_CLAUDE_DIR} --exclude=./sessions --exclude=./daemon.* --ignore-failed-read .`
}

export interface ArchiveDeps {
  adapter: Pick<SbxAdapter, 'probeSandboxPath' | 'execScript' | 'copyFromSandbox'>
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
  /** Records entries skipped because they could not be copied. */
  log?: Logger
}

/** How many archives a definition keeps before the oldest is pruned. */
export const DEFAULT_KEEP = 3

// The renderer lists and exports these too, so the shape lives in shared/.
export type { ArchiveEntry }

/**
 * Split `<sbxName>-<stamp>` back into its parts. The stamp is a fixed-shape ISO string with
 * `:` and `.` replaced by `-`, so it is matched from the END — an instance name may itself
 * contain hyphens (they nearly all do: `xray-claude-0c6bea75`), which rules out a plain split.
 */
function parseArchiveName(name: string): { sbxName: string; capturedAt: string } | null {
  const m = /^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)$/.exec(name)
  if (!m) return null
  const [, sbxName, stamp] = m
  // Reverse stamp(): the last three '-' before the trailing Z were ':' ':' and '.'.
  const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
  return { sbxName, capturedAt: iso }
}

/**
 * A definition's archives, newest first. Returns [] rather than throwing for a definition
 * that never captured anything, or before the archive root exists at all — "no backups yet"
 * is the normal case for a fresh install, not an error worth surfacing.
 */
export function listArchives(baseDir: string, definitionId: string): ArchiveEntry[] {
  const root = join(baseDir, 'session-archives', definitionId)
  let names: string[]
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
  return names
    .sort()
    .reverse() // names end in the sortable stamp, so reverse is newest-first
    .flatMap((name) => {
      const parsed = parseArchiveName(name)
      return parsed ? [{ dir: join(root, name), ...parsed }] : []
    })
}

/**
 * Copy an archive into `destDir`, returning the directory written.
 *
 * A copy, never a move: the archive stays in place as the rebuild safety net. The copy is
 * nested under the archive's own name so exporting two archives to the same folder cannot
 * merge one conversation's transcripts into another's.
 */
export function exportArchive(archiveDir: string, destDir: string): string {
  const out = join(destDir, archiveDir.replace(/[\\/]$/, '').split(/[\\/]/).pop() as string)
  cpSync(archiveDir, out, { recursive: true })
  return out
}

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
  // No transcripts (a never-used sandbox) is not a failure — the caller proceeds as before.
  if (await deps.adapter.probeSandboxPath(opts.sbxName, `${SANDBOX_CLAUDE_DIR}/projects`) !== 'dir') return null

  const root = join(opts.baseDir, 'session-archives', opts.definitionId)
  const at = (opts.now ?? (() => new Date()))()
  const dir = join(root, `${opts.sbxName}-${stamp(at)}`)
  mkdirSync(dir, { recursive: true })

  // Deliberately NOT caught: instance:rebuild destroys the sandbox next, so a failure here
  // must abort the rebuild rather than let it proceed and lose the conversations.
  await deps.adapter.execScript(opts.sbxName, archiveScript())
  await deps.adapter.copyFromSandbox(opts.sbxName, SANDBOX_TMP_ARCHIVE, dir)
  // Best-effort tidy-up: the sandbox is usually about to be deleted anyway.
  try {
    await deps.adapter.execScript(opts.sbxName, `rm -f ${SANDBOX_TMP_ARCHIVE}`)
  } catch (e) {
    opts.log?.info(`Could not remove the staged archive in "${opts.sbxName}": ${(e as Error).message}`)
  }

  prune(root, opts.keep ?? DEFAULT_KEEP)
  return dir
}
