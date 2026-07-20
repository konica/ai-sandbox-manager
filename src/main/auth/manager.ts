import type { DefinitionSpec } from '@shared/types'
import { parseClaudeAuth, type AuthStatus, type ClaudeAuthKind } from './status'

export async function claudeAuthStatus(deps: { listGlobalSecretsRaw: () => Promise<string> }): Promise<AuthStatus> {
  try {
    return { anthropic: parseClaudeAuth(await deps.listGlobalSecretsRaw()) }
  } catch {
    return { anthropic: 'none' } // fail open to the nudge; never block on detection
  }
}

export async function claudeSignOut(deps: { removeSecret: (s: string, o: { global?: boolean }) => Promise<void> }): Promise<void> {
  await deps.removeSecret('anthropic', { global: true })
}

export function hasAnthropicCredential(spec: DefinitionSpec): boolean {
  return spec.credentials.some((c) => c.kind === 'service' && c.serviceId === 'anthropic')
}

export function needsAuthNudge(status: ClaudeAuthKind, spec: DefinitionSpec): boolean {
  return status === 'none' && !hasAnthropicCredential(spec)
}
