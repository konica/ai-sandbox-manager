export type CopyDirection = 'toSandbox' | 'fromSandbox'

export interface FsEntry {
  name: string
  isDir: boolean
}

export type ListResult =
  | { ok: true; cwd: string; entries: FsEntry[] }
  | { ok: false; error: string }

export interface PlanItem {
  source: string
  resolvedSource: string
  target: string
  willOverwrite: boolean
}

export interface PlanResult {
  resolvedDest: string
  items: PlanItem[]
}

export interface CopyResult {
  source: string
  ok: boolean
  error?: string
}

// Sentinels emitted by the sandbox `ls` probe (see src/main/sbx/fs-probe.ts). Kept here so the
// script builder and this parser share one contract.
export const LS_PWD_MARK = '__SBX_PWD__'
export const LS_ERR_MARK = '__SBX_LS_ERR__'

/** basename that tolerates both posix and windows separators and trailing separators. */
export function basenameAny(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

export function posixJoin(dir: string, name: string): string {
  if (!dir) return name
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

/** Resolve a sandbox path: absolute (/…) and ~ pass through; relative joins onto the default dir. */
export function resolveSandboxPath(defaultDir: string, input: string): string {
  const s = input.trim()
  if (s.startsWith('/') || s.startsWith('~')) return s
  const base = defaultDir.trim() || '.'
  return posixJoin(base, s)
}

/** Parse the sandbox list-dir probe output into a ListResult (cwd + entries, dirs first). */
export function parseListOutput(stdout: string): ListResult {
  const lines = stdout.split('\n')
  if (lines.some((l) => l.trim() === LS_ERR_MARK)) {
    return { ok: false, error: 'Directory not found or not readable' }
  }
  let cwd = ''
  const entries: FsEntry[] = []
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith(`${LS_PWD_MARK} `)) { cwd = line.slice(LS_PWD_MARK.length + 1).trim(); continue }
    if (!line.trim()) continue
    const isDir = line.endsWith('/')
    entries.push({ name: isDir ? line.slice(0, -1) : line, isDir })
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return { ok: true, cwd, entries }
}
