import { LS_PWD_MARK, LS_ERR_MARK } from '@shared/copy'

/**
 * Probe scripts run inside a running sandbox via `sbx exec <name> bash -lc <script>`.
 * All caller-supplied paths pass through shellSingleQuote before entering a script.
 */

/** Single-quote a string for safe embedding in a bash script. */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * cd into the directory (login shell → resolves ~, relative, and symlinks), print the resolved
 * absolute path prefixed with LS_PWD_MARK, then `ls -1Ap` (one per line, almost-all, trailing `/`
 * on dirs). On cd failure print LS_ERR_MARK so the renderer shows an inline error.
 */
export function listDirScript(path: string): string {
  const p = shellSingleQuote(path)
  return `if cd -- ${p} 2>/dev/null; then echo "${LS_PWD_MARK} $(pwd)"; ls -1Ap; else echo '${LS_ERR_MARK}'; fi`
}

/** Print `dir`, `file`, or `missing` for a resolved path. */
export function statScript(path: string): string {
  const p = shellSingleQuote(path)
  return `if [ -d ${p} ]; then echo dir; elif [ -e ${p} ]; then echo file; else echo missing; fi`
}

/** Print `1` (exists) or `0` (missing) for each path, one per line, in order. */
export function existsScript(paths: string[]): string {
  if (paths.length === 0) return 'true'
  return paths.map((p) => `[ -e ${shellSingleQuote(p)} ] && echo 1 || echo 0`).join('\n')
}

export function parseStat(stdout: string): 'dir' | 'file' | 'missing' {
  const t = stdout.trim()
  return t === 'dir' || t === 'file' ? t : 'missing'
}

export function parseExists(stdout: string, count: number): boolean[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l === '0' || l === '1')
  return Array.from({ length: count }, (_, i) => lines[i] === '1')
}
