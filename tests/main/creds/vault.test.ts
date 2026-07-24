import { describe, it, expect } from 'vitest'
import { createMemoryVault } from '../../../src/main/creds/vault'

describe('SecretVault (memory)', () => {
  it('round-trips a value', () => {
    const v = createMemoryVault()
    v.set('acme', 's3cr3t')
    expect(v.get('acme')).toBe('s3cr3t')
  })
  it('returns null for a missing key and after delete', () => {
    const v = createMemoryVault()
    expect(v.get('nope')).toBeNull()
    v.set('x', '1'); v.delete('x')
    expect(v.get('x')).toBeNull()
  })
})

import { createSafeStorageVault, storageStatus, type ElectronSafeStorage, type VaultFs } from '../../../src/main/creds/vault'

function fakeSS(opts: { available?: boolean; backend?: string }): ElectronSafeStorage {
  return {
    isEncryptionAvailable: () => opts.available ?? true,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
    getSelectedStorageBackend: () => opts.backend ?? 'unknown'
  }
}
function memFs(): VaultFs {
  const files = new Map<string, Buffer>()
  return {
    mkdir: () => {},
    writeFile: (p, data) => { files.set(p, data) },
    readFile: (p) => files.get(p) ?? null,
    rm: (p) => { files.delete(p) }
  }
}

describe('SecretVault (safeStorage, fail-closed)', () => {
  it('writes and round-trips on macOS', () => {
    const v = createSafeStorageVault({ dir: '/v', safeStorage: fakeSS({}), fs: memFs(), platform: 'darwin' })
    v.set('k', 'secret'); expect(v.get('k')).toBe('secret')
  })
  it('writes on Linux with a real keyring', () => {
    const v = createSafeStorageVault({ dir: '/v', safeStorage: fakeSS({ backend: 'gnome_libsecret' }), fs: memFs(), platform: 'linux' })
    v.set('k', 'secret'); expect(v.get('k')).toBe('secret')
  })
  it('fails closed on Linux with only basic_text', () => {
    const v = createSafeStorageVault({ dir: '/v', safeStorage: fakeSS({ backend: 'basic_text' }), fs: memFs(), platform: 'linux' })
    expect(() => v.set('k', 'secret')).toThrowError(/secure/i)
    expect(v.get('k')).toBeNull() // nothing was written
  })
  it('reports storageStatus per platform/backend', () => {
    expect(storageStatus('darwin', fakeSS({}))).toEqual({ platform: 'darwin', backend: 'keychain', secure: true })
    expect(storageStatus('linux', fakeSS({ backend: 'basic_text' }))).toEqual({ platform: 'linux', backend: 'basic_text', secure: false })
  })
})
