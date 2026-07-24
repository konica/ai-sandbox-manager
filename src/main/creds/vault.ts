import { createHash } from 'node:crypto'
import { SbxError } from '@shared/errors'

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
  getSelectedStorageBackend?(): string // Linux-only; used to reject the weak basic_text backend
}
export interface VaultFs {
  writeFile(path: string, data: Buffer, mode: number): void
  readFile(path: string): Buffer | null
  rm(path: string): void
  mkdir(path: string): void
}

const SECURE_LINUX_BACKENDS = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])

function backendSecure(platform: string, ss: ElectronSafeStorage): boolean {
  if (!ss.isEncryptionAvailable()) return false
  if (platform !== 'linux') return true // macOS Keychain / Windows DPAPI
  return SECURE_LINUX_BACKENDS.has(ss.getSelectedStorageBackend?.() ?? 'unknown')
}

// Report where/how credentials are stored on this host, for the read-only Settings guide.
export function storageStatus(platform: string, ss: ElectronSafeStorage): { platform: string; backend: string; secure: boolean } {
  const backend = platform === 'darwin' ? 'keychain' : platform === 'win32' ? 'dpapi' : (ss.getSelectedStorageBackend?.() ?? 'unknown')
  return { platform, backend, secure: backendSecure(platform, ss) }
}

export function createSafeStorageVault(deps: { dir: string; safeStorage: ElectronSafeStorage; fs: VaultFs; platform?: string }): SecretVault {
  const platform = deps.platform ?? process.platform
  deps.fs.mkdir(deps.dir)
  const file = (key: string): string => `${deps.dir}/${createHash('sha256').update(key).digest('hex')}.bin`
  return {
    set: (k, v) => {
      if (!backendSecure(platform, deps.safeStorage)) {
        throw new SbxError('insecure-storage', 'No secure OS keyring is available to encrypt credentials at rest on this machine.')
      }
      deps.fs.writeFile(file(k), deps.safeStorage.encryptString(v), 0o600)
    },
    get: (k) => {
      const buf = deps.fs.readFile(file(k))
      return buf ? deps.safeStorage.decryptString(buf) : null
    },
    delete: (k) => { deps.fs.rm(file(k)) }
  }
}
