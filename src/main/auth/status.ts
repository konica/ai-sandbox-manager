export type ClaudeAuthKind = 'oauth' | 'apikey' | 'none'
export interface AuthStatus { anthropic: ClaudeAuthKind }

/**
 * Parse `sbx secret ls -g` output for the Claude (anthropic) auth state.
 * Verified marker (2026-07-20): a global OAuth login shows
 *   `(global)  service  anthropic  (oauth configured)`
 * while an API key shows a masked value (`sk-ant…`). Only the global scope counts.
 */
export function parseClaudeAuth(secretLsGlobalStdout: string): ClaudeAuthKind {
  for (const line of secretLsGlobalStdout.split('\n')) {
    const cols = line.trim().split(/\s{2,}/) // columns are 2+ space separated
    if (cols.length < 4) continue
    const [scope, , name, secret] = cols
    if (!/\(global\)/.test(scope)) continue
    if (name.trim() !== 'anthropic') continue
    return /oauth/i.test(secret) ? 'oauth' : 'apikey'
  }
  return 'none'
}
