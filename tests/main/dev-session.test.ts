import { describe, it, expect } from 'vitest'
import { prepareDevSessionData, type DevSessionFs } from '../../src/main/dev-session'

const USER_DATA = '/u/data'
const CANONICAL = `${USER_DATA}/Local State`
const DEV_DIR = `${USER_DATA}/dev-session`
const DEV_STATE = `${DEV_DIR}/Local State`

function fakeFs(files: Record<string, string>): DevSessionFs & { files: Record<string, string>; made: string[] } {
  const made: string[] = []
  return {
    files,
    made,
    readFile: (p) => (p in files ? files[p] : null),
    writeFile: (p, data) => { files[p] = data },
    mkdir: (p) => { made.push(p) }
  }
}

const localState = (key: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ os_crypt: { audit_enabled: true, encrypted_key: key }, ...extra })

const keyOf = (raw: string): string => JSON.parse(raw).os_crypt.encrypted_key

describe('prepareDevSessionData', () => {
  it('declines to relocate when userData holds no Local State yet', () => {
    // Nothing to pair with: a fresh dev key here would orphan the vault the packaged app
    // later writes. Stay on the shared profile so Chromium mints the key canonically.
    const fs = fakeFs({})
    expect(prepareDevSessionData(USER_DATA, fs)).toBeNull()
    expect(fs.made).toEqual([])
    expect(Object.keys(fs.files)).toEqual([])
  })

  it('declines to relocate when the canonical Local State carries no OSCrypt key', () => {
    const fs = fakeFs({ [CANONICAL]: JSON.stringify({ user_experience_metrics: {} }) })
    expect(prepareDevSessionData(USER_DATA, fs)).toBeNull()
    expect(fs.files[DEV_STATE]).toBeUndefined()
  })

  it('declines to relocate when the canonical Local State is unreadable', () => {
    const fs = fakeFs({ [CANONICAL]: 'not json{' })
    expect(prepareDevSessionData(USER_DATA, fs)).toBeNull()
    expect(fs.files[DEV_STATE]).toBeUndefined()
  })

  it('seeds a missing dev copy with the canonical OSCrypt key and returns the dir', () => {
    const fs = fakeFs({ [CANONICAL]: localState('canonical-key') })
    expect(prepareDevSessionData(USER_DATA, fs)).toBe(DEV_DIR)
    expect(fs.made).toEqual([DEV_DIR])
    expect(keyOf(fs.files[DEV_STATE])).toBe('canonical-key')
  })

  it('rewrites a dev copy whose key has drifted, keeping its other preferences', () => {
    const fs = fakeFs({
      [CANONICAL]: localState('canonical-key'),
      [DEV_STATE]: localState('stale-key', { profile: { last_used: 'dev' } })
    })
    expect(prepareDevSessionData(USER_DATA, fs)).toBe(DEV_DIR)
    expect(keyOf(fs.files[DEV_STATE])).toBe('canonical-key')
    expect(JSON.parse(fs.files[DEV_STATE]).profile).toEqual({ last_used: 'dev' })
  })

  it('replaces an unparseable dev copy outright', () => {
    const fs = fakeFs({ [CANONICAL]: localState('canonical-key'), [DEV_STATE]: 'truncated{' })
    expect(prepareDevSessionData(USER_DATA, fs)).toBe(DEV_DIR)
    expect(keyOf(fs.files[DEV_STATE])).toBe('canonical-key')
  })

  it('leaves an already-paired dev copy byte-for-byte alone', () => {
    const paired = localState('canonical-key', { profile: { last_used: 'dev' } })
    const fs = fakeFs({ [CANONICAL]: localState('canonical-key'), [DEV_STATE]: paired })
    expect(prepareDevSessionData(USER_DATA, fs)).toBe(DEV_DIR)
    expect(fs.files[DEV_STATE]).toBe(paired)
  })
})
