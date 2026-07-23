import type { DefinitionSpec } from '@shared/types'
import { parseClaudeAuth, type AuthStatus } from './status'

export async function claudeAuthStatus(deps: { listGlobalSecretsRaw: () => Promise<string> }): Promise<AuthStatus> {
  try {
    return { anthropic: parseClaudeAuth(await deps.listGlobalSecretsRaw()) }
  } catch {
    return { anthropic: 'none' } // best-effort detection; never block on it
  }
}

export async function claudeSignOut(deps: { removeSecret: (s: string, o: { global?: boolean }) => Promise<void> }): Promise<void> {
  await deps.removeSecret('anthropic', { global: true })
}

export function hasAnthropicCredential(spec: DefinitionSpec): boolean {
  return spec.credentials.some((c) => c.kind === 'service' && c.serviceId === 'anthropic')
}
