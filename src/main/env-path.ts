// A macOS app launched from Finder (or Windows from Explorer) inherits a minimal
// PATH that omits Homebrew (/opt/homebrew/bin, /usr/local/bin) etc., so `docker`,
// `sbx`, and `code` aren't found by child_process spawns — the prereq probes then
// wrongly report them missing. Merging the login shell's PATH into this process
// repairs that for every spawn. (`npm run dev` never hits this: it inherits the
// terminal's full PATH.)

/**
 * Merge a login-shell PATH with the current process PATH: login entries first,
 * then any current entries not already present, de-duplicated, empty parts dropped.
 * Login entries win order so Homebrew tools resolve ahead of the minimal defaults.
 */
export function mergePaths(loginPath: string | undefined, currentPath: string | undefined): string {
  const parts = [...(loginPath ?? '').split(':'), ...(currentPath ?? '').split(':')].filter((p) => p.length > 0)
  return [...new Set(parts)].join(':')
}
