import { describe, it, expect, vi } from 'vitest'
import { applyCredentialsLive } from '../../../src/main/creds/apply-live'
import { credFingerprint } from '../../../src/main/creds/register'
import type { DefinitionSpec } from '../../../src/shared/types'

const base: DefinitionSpec = {
  definition: { id: 'd1', name: 'P', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [],
  credentials: [{ kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }]
}

// `sbx secret ls <name>` fixture: custom secret ACME_KEY (desired) in scope sbx-1.
const SECRET_LS = `CUSTOM SECRETS
SCOPE   TARGETS        ENV        PLACEHOLDER               SECRET
sbx-1   api.acme.com   ACME_KEY   sbx-cs-ACMEplaceholder01  GIx*****...*****i2cm
`
// …plus a stale custom (OLD_KEY) and a stale service (openai) no longer in the definition.
const SECRET_LS_WITH_STALE = `SCOPE   TYPE      NAME     SECRET
sbx-1   service   openai   sk-pro*****...*****Ft8A

CUSTOM SECRETS
SCOPE   TARGETS           ENV        PLACEHOLDER               SECRET
sbx-1   api.acme.com      ACME_KEY   sbx-cs-ACMEplaceholder01  GIx*****...*****i2cm
sbx-1   old.example.com   OLD_KEY    sbx-cs-OLDplaceholder02   GIx*****...*****i2cm
`

function deps(running = true, secretLs = SECRET_LS) {
  const adapter = {
    listSandboxes: vi.fn(async () => running ? [{ name: 'sbx-1', status: 'running', agent: 'claude', ports: [], workspace: '/p' }] : []),
    setSecret: vi.fn(async () => {}), setCustomSecret: vi.fn(async () => {}), setRegistrySecret: vi.fn(async () => {}),
    removeSecret: vi.fn(async () => {}), removeCustomSecret: vi.fn(async () => {}),
    removeCustomSecretByPlaceholder: vi.fn(async () => {}),
    execScript: vi.fn(async (_name: string, _script: string) => {}),
    listInstanceSecretsRaw: vi.fn(async (_name: string) => secretLs)
  }
  const store = { updateInstanceFingerprint: vi.fn() }
  const creds = { getStaged: vi.fn(() => 'secret-val' as string | null) }
  return { adapter, store, creds, log: undefined }
}

describe('applyCredentialsLive', () => {
  it('upserts a custom secret (remove-then-set so a changed value overwrites) and injects its dynamic placeholder', async () => {
    const d = deps()
    const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: 'stale' })
    // remove-then-set guarantees the new value overwrites, then re-read gives the placeholder.
    expect(d.adapter.removeCustomSecretByPlaceholder).toHaveBeenCalledWith('sbx-cs-ACMEplaceholder01', { sandbox: 'sbx-1' })
    expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['api.acme.com'], 'ACME_KEY', 'secret-val', { sandbox: 'sbx-1' })
    const rmOrder = d.adapter.removeCustomSecretByPlaceholder.mock.invocationCallOrder[0]
    const setOrder = d.adapter.setCustomSecret.mock.invocationCallOrder[0]
    expect(rmOrder).toBeLessThan(setOrder) // remove BEFORE set
    const script = d.adapter.execScript.mock.calls[0][1] as string
    expect(script).toContain("export ACME_KEY='sbx-cs-ACMEplaceholder01'")
    expect(d.store.updateInstanceFingerprint).toHaveBeenCalledWith('sbx-1', credFingerprint(base.credentials))
    expect(r).toEqual({ applied: 1, removed: 0, skipped: 0, failed: 0 })
  })

  it('removes sandbox secrets that are no longer in the definition (deleted custom + service)', async () => {
    const d = deps(true, SECRET_LS_WITH_STALE)
    const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: 'stale' })
    // OLD_KEY (custom) and openai (service) are not in the definition → removed.
    expect(d.adapter.removeCustomSecretByPlaceholder).toHaveBeenCalledWith('sbx-cs-OLDplaceholder02', { sandbox: 'sbx-1' })
    expect(d.adapter.removeSecret).toHaveBeenCalledWith('openai', { sandbox: 'sbx-1' })
    // ACME_KEY stays and is upserted (not removed as stale).
    expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['api.acme.com'], 'ACME_KEY', 'secret-val', { sandbox: 'sbx-1' })
    expect(r).toEqual({ applied: 1, removed: 2, skipped: 0, failed: 0 })
  })

  it('removes the old host grant when a custom secret keeps its env var but its domains change', async () => {
    // Definition wants ACME_KEY at api.acme.com (base); the sandbox has it at old.example.com.
    const d = deps(true, `CUSTOM SECRETS
SCOPE   TARGETS           ENV        PLACEHOLDER        SECRET
sbx-1   old.example.com   ACME_KEY   sbx-cs-OLDhost01   GIx*`)
    const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: 'stale' })
    expect(d.adapter.removeCustomSecretByPlaceholder).toHaveBeenCalledWith('sbx-cs-OLDhost01', { sandbox: 'sbx-1' }) // stale old grant removed
    expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['api.acme.com'], 'ACME_KEY', 'secret-val', { sandbox: 'sbx-1' }) // re-set at new host
    expect(r).toEqual({ applied: 1, removed: 1, skipped: 0, failed: 0 })
  })

  it('upserts a SERVICE credential via remove-then-set', async () => {
    const spec: DefinitionSpec = { ...base, credentials: [{ kind: 'service', serviceId: 'openai', envVar: 'OPENAI_API_KEY', store: 'sbx' }] }
    const d = deps(true, 'CUSTOM SECRETS\n') // sandbox has nothing registered
    const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec, storedFingerprint: 'stale' })
    expect(d.adapter.removeSecret).toHaveBeenCalledWith('openai', { sandbox: 'sbx-1' })
    expect(d.adapter.setSecret).toHaveBeenCalledWith('openai', 'secret-val', { sandbox: 'sbx-1' })
    expect(d.adapter.removeSecret.mock.invocationCallOrder[0]).toBeLessThan(d.adapter.setSecret.mock.invocationCallOrder[0])
    expect(r).toEqual({ applied: 1, removed: 0, skipped: 0, failed: 0 })
  })

  it('leaves a desired credential untouched (does not wipe it) when it has no stored value', async () => {
    const d = deps()
    d.creds.getStaged.mockReturnValue(null)
    const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: 'stale' })
    expect(d.adapter.setCustomSecret).not.toHaveBeenCalled()
    expect(d.adapter.removeCustomSecretByPlaceholder).not.toHaveBeenCalled() // ACME_KEY is desired → not stale; no value → not re-set
    expect(r).toEqual({ applied: 0, removed: 0, skipped: 1, failed: 0 })
  })

  it('throws when the sandbox is not running and writes nothing', async () => {
    const d = deps(false)
    await expect(applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: null }))
      .rejects.toThrow(/not running/i)
    expect(d.adapter.execScript).not.toHaveBeenCalled()
    expect(d.adapter.removeCustomSecretByPlaceholder).not.toHaveBeenCalled()
    expect(d.store.updateInstanceFingerprint).not.toHaveBeenCalled()
  })

  it('does NOT update the fingerprint if execScript fails (drift + Rebuild stay available)', async () => {
    const d = deps()
    d.adapter.execScript.mockRejectedValueOnce(new Error('read-only /etc'))
    await expect(applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: 'stale' }))
      .rejects.toThrow('read-only /etc')
    expect(d.store.updateInstanceFingerprint).not.toHaveBeenCalled()
  })

  it('applies service/custom live but leaves drift set when a registry cred also changed', async () => {
    const d = deps()
    const spec: DefinitionSpec = {
      ...base,
      credentials: [...base.credentials, { kind: 'registry', id: 'ghcr', host: 'ghcr.io', scope: 'sandbox', store: 'sbx' }]
    }
    await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec, storedFingerprint: credFingerprint(base.credentials) })
    expect(d.adapter.execScript).toHaveBeenCalled()
    expect(d.adapter.setRegistrySecret).not.toHaveBeenCalled() // registry excluded from live reconcile
    const script = d.adapter.execScript.mock.calls[0][1] as string
    expect(script).not.toContain('ghcr')
    expect(d.store.updateInstanceFingerprint).not.toHaveBeenCalled()
  })

  // The upsert's `rm` is best-effort: it exists so a CHANGED value overwrites. When it fails there
  // is nothing to overwrite, so the `set` must still run — bundling them in one try turned a
  // failing rm into a credential that was never registered at all.
  it('still sets the custom secret when the preceding remove fails', async () => {
    const d = deps()
    d.adapter.removeCustomSecretByPlaceholder.mockRejectedValueOnce(new Error('rm refused'))
    const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: 'stale' })
    expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['api.acme.com'], 'ACME_KEY', 'secret-val', { sandbox: 'sbx-1' })
    expect(r).toEqual({ applied: 1, removed: 0, skipped: 0, failed: 0 })
  })

  it('reports a failed credential and leaves drift set, so the apply is not reported as a success', async () => {
    const d = deps()
    d.adapter.setCustomSecret.mockRejectedValueOnce(new Error('invalid target'))
    const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: 'stale' })
    expect(r).toEqual({ applied: 0, removed: 0, skipped: 0, failed: 1 })
    expect(d.store.updateInstanceFingerprint).not.toHaveBeenCalled()
  })


  // Two credentials sharing one host is a shape sbx supports (verified against the CLI: two envs,
  // one target, one placeholder each). Removing by host during the upsert deleted whichever
  // sibling had just been written, so only the last credential survived.
  describe('two custom secrets on the same host', () => {
    const shared: DefinitionSpec = {
      ...base,
      credentials: [
        { kind: 'custom', id: 'google-client-id', label: 'Google', envVar: 'GOOGLE_CLIENT_ID', domains: ['accounts.google.com'], store: 'encrypted' },
        { kind: 'custom', id: 'google-client-secret', label: 'Google', envVar: 'GOOGLE_CLIENT_SECRET', domains: ['accounts.google.com'], store: 'encrypted' }
      ]
    }
    const BOTH = `CUSTOM SECRETS
SCOPE   TARGETS               ENV                    PLACEHOLDER          SECRET
sbx-1   accounts.google.com   GOOGLE_CLIENT_ID       sbx-cs-IDtoken01     GIx*
sbx-1   accounts.google.com   GOOGLE_CLIENT_SECRET   sbx-cs-SECRETtok02   GIx*
`

    it('sets both, removing each by its own placeholder so neither wipes the other', async () => {
      const d = deps(true, BOTH)
      const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: shared, storedFingerprint: 'stale' })
      // Never remove by host — that would take the sibling down with it.
      expect(d.adapter.removeCustomSecret).not.toHaveBeenCalled()
      expect(d.adapter.removeCustomSecretByPlaceholder).toHaveBeenCalledWith('sbx-cs-IDtoken01', { sandbox: 'sbx-1' })
      expect(d.adapter.removeCustomSecretByPlaceholder).toHaveBeenCalledWith('sbx-cs-SECRETtok02', { sandbox: 'sbx-1' })
      expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['accounts.google.com'], 'GOOGLE_CLIENT_ID', 'secret-val', { sandbox: 'sbx-1' })
      expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['accounts.google.com'], 'GOOGLE_CLIENT_SECRET', 'secret-val', { sandbox: 'sbx-1' })
      expect(r).toEqual({ applied: 2, removed: 0, skipped: 0, failed: 0 })
    })

    it('injects a placeholder env var for each of them', async () => {
      const d = deps(true, BOTH)
      await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: shared, storedFingerprint: 'stale' })
      const script = d.adapter.execScript.mock.calls[0][1] as string
      expect(script).toContain("export GOOGLE_CLIENT_ID='sbx-cs-IDtoken01'")
      expect(script).toContain("export GOOGLE_CLIENT_SECRET='sbx-cs-SECRETtok02'")
    })

    it('leaves the sibling alone when only one of them is deleted from the definition', async () => {
      // Definition now wants ONLY GOOGLE_CLIENT_ID; the sandbox still has both.
      const onlyId: DefinitionSpec = { ...shared, credentials: [shared.credentials[0]] }
      const d = deps(true, BOTH)
      const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: onlyId, storedFingerprint: 'stale' })
      expect(d.adapter.removeCustomSecretByPlaceholder).toHaveBeenCalledWith('sbx-cs-SECRETtok02', { sandbox: 'sbx-1' }) // the stale one
      expect(d.adapter.removeCustomSecret).not.toHaveBeenCalled() // never the whole host
      expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['accounts.google.com'], 'GOOGLE_CLIENT_ID', 'secret-val', { sandbox: 'sbx-1' })
      expect(r.removed).toBe(1)
    })

    it('skips the remove for a credential that is not registered yet', async () => {
      const d = deps(true, 'CUSTOM SECRETS\n') // nothing registered
      await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: shared, storedFingerprint: 'stale' })
      expect(d.adapter.removeCustomSecretByPlaceholder).not.toHaveBeenCalled()
      expect(d.adapter.setCustomSecret).toHaveBeenCalledTimes(2)
    })
  })
})
