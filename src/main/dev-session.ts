// Chromium keeps its session data — GPUCache, Code Cache, DawnGraphiteCache, DawnWebGPUCache,
// Session Storage, blob_storage — in the `sessionData` dir, which defaults to `userData`. So an
// `npm run dev` instance and the installed app fight over one profile: whichever starts second
// finds the caches locked by the first and logs "Unable to move the cache: Access is denied".
//
// The fix is to give the unpackaged build its own sessionData subdir, but `Local State` lives
// there too — and on Windows it holds the DPAPI-wrapped AES key that OSCrypt, and therefore
// safeStorage, encrypts with. A bare relocation makes Chromium mint a FRESH key at the new path,
// leaving the vault under the still-shared `userData` (written with the original key) impossible
// to decrypt: "Error while decrypting the ciphertext provided to safeStorage.decryptString".
// That is exactly how the first attempt at this broke (#94), so the key must stay paired with
// the vault it encrypted: seed the dev copy from the canonical one.

const DEV_SESSION_DIR = 'dev-session'
const LOCAL_STATE = 'Local State'

export interface DevSessionFs {
  readFile(path: string): string | null
  writeFile(path: string, data: string): void
  mkdir(path: string): void
}

interface LocalStateFile {
  os_crypt?: { encrypted_key?: string }
  [key: string]: unknown
}

function parse(raw: string | null): LocalStateFile | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as LocalStateFile) : null
  } catch {
    return null
  }
}

/**
 * Pick the `sessionData` dir for an unpackaged build, seeding its `Local State` so the OSCrypt
 * key matches the one the shared `userData` vault was encrypted with.
 *
 * Returns the dir to hand to `app.setPath('sessionData', …)`, or null to leave sessionData
 * shared. Null is the answer whenever `userData` has no usable key yet — on a machine where the
 * app has never run, relocating first would mint the key inside `dev-session`, and the packaged
 * app would later mint a different one for itself, which is the same orphaned-vault bug mirrored.
 * Staying shared lets Chromium create the key canonically; the next dev launch seeds from it.
 */
export function prepareDevSessionData(userData: string, fs: DevSessionFs): string | null {
  const canonical = parse(fs.readFile(`${userData}/${LOCAL_STATE}`))
  const key = canonical?.os_crypt?.encrypted_key
  if (!canonical || !key) return null

  const dir = `${userData}/${DEV_SESSION_DIR}`
  const devState = `${dir}/${LOCAL_STATE}`
  const existing = parse(fs.readFile(devState))
  if (existing?.os_crypt?.encrypted_key === key) return dir

  // Keep whatever else the dev profile has accumulated; only the key has to be pinned.
  const seeded = existing ? { ...existing, os_crypt: canonical.os_crypt } : canonical
  fs.mkdir(dir)
  fs.writeFile(devState, JSON.stringify(seeded))
  return dir
}
