import type { SbxErrorKind } from './types-errors'

export type { SbxErrorKind }

export class SbxError extends Error {
  readonly kind: SbxErrorKind
  constructor(kind: SbxErrorKind, message: string) {
    super(message)
    this.name = 'SbxError'
    this.kind = kind
  }
}

export function classifySbxError(code: number, stderr: string): SbxErrorKind {
  const s = stderr.toLowerCase()
  if (code === 127 || s.includes('command not found') || s.includes('enoent')) return 'not-installed'
  if (s.includes('not logged in') || s.includes('sbx login') || s.includes('unauthenticated')) return 'not-authed'
  if (s.includes('not found')) return 'not-found'
  if (s.includes('policy') && (s.includes('denied') || s.includes('rejected'))) return 'policy-rejected'
  return 'generic'
}
