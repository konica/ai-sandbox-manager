import type { GlobalSecretMeta } from '@shared/types'
import { serviceById } from '@shared/services'
import type { SecretVault } from './vault'

interface Adapter {
  setSecret(s: string, v: string, o: { global?: boolean; sandbox?: string }): Promise<void>
  removeSecret(s: string, o: { global?: boolean; sandbox?: string }): Promise<void>
}
interface Store {
  upsertGlobalSecret(g: GlobalSecretMeta): void
  deleteGlobalSecret(id: string): void
  listGlobalSecrets(): GlobalSecretMeta[]
}

export interface CredentialManager {
  setGlobalService(serviceId: string, value: string): Promise<GlobalSecretMeta>
  removeGlobalSecret(id: string): Promise<void>
  listGlobalSecrets(): GlobalSecretMeta[]
  stageServiceValue(serviceId: string, value: string): void
  stageCustomValue(credId: string, value: string): void
  takeStaged(key: string): string | null
}

export function createCredentialManager(deps: { adapter: Adapter; vault: SecretVault; store: Store; now?: () => number }): CredentialManager {
  const now = deps.now ?? (() => Date.now())
  return {
    async setGlobalService(serviceId, value) {
      const svc = serviceById(serviceId)
      if (!svc) throw new Error(`unknown service "${serviceId}"`)
      await deps.adapter.setSecret(serviceId, value, { global: true })
      const meta: GlobalSecretMeta = { id: serviceId, label: svc.label, envVar: svc.envVars[0], store: 'sbx', createdAt: new Date(now()).toISOString() }
      deps.store.upsertGlobalSecret(meta)
      return meta
    },
    async removeGlobalSecret(id) {
      await deps.adapter.removeSecret(id, { global: true })
      deps.store.deleteGlobalSecret(id)
    },
    listGlobalSecrets: () => deps.store.listGlobalSecrets(),
    stageServiceValue: (serviceId, value) => deps.vault.set(`def:${serviceId}`, value),
    stageCustomValue: (credId, value) => deps.vault.set(`def:${credId}`, value),
    takeStaged: (key) => {
      const v = deps.vault.get(key)
      if (v !== null) deps.vault.delete(key)
      return v
    }
  }
}
