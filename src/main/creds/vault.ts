import { createHash } from 'node:crypto'

export interface SecretVault {
  set(key: string, value: string): void
  get(key: string): string | null
  delete(key: string): void
}

export function createMemoryVault(): SecretVault {
  const m = new Map<string, string>()
  return {
    set: (k, v) => { m.set(k, v) },
    get: (k) => (m.has(k) ? m.get(k)! : null),
    delete: (k) => { m.delete(k) }
  }
}

// Electron main-process vault. safeStorage is OS-keychain-backed on macOS/Windows.
export interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}
export interface VaultFs {
  writeFile(path: string, data: Buffer, mode: number): void
  readFile(path: string): Buffer | null
  rm(path: string): void
  mkdir(path: string): void
}

export function createSafeStorageVault(deps: { dir: string; safeStorage: ElectronSafeStorage; fs: VaultFs }): SecretVault {
  deps.fs.mkdir(deps.dir)
  const file = (key: string): string => `${deps.dir}/${createHash('sha256').update(key).digest('hex')}.bin`
  return {
    set: (k, v) => {
      if (!deps.safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
      deps.fs.writeFile(file(k), deps.safeStorage.encryptString(v), 0o600)
    },
    get: (k) => {
      const buf = deps.fs.readFile(file(k))
      return buf ? deps.safeStorage.decryptString(buf) : null
    },
    delete: (k) => { deps.fs.rm(file(k)) }
  }
}
