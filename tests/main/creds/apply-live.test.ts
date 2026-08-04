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

// `sbx secret ls` fixture: custom secret ACME_KEY in scope sbx-1 has a dynamic placeholder.
const SECRET_LS = `CUSTOM SECRETS
SCOPE   TARGETS        ENV        PLACEHOLDER               SECRET
sbx-1   api.acme.com   ACME_KEY   sbx-cs-ACMEplaceholder01  GIx*****...*****i2cm
`

function deps(running = true, secretLs = SECRET_LS) {
  const adapter = {
    listSandboxes: vi.fn(async () => running ? [{ name: 'sbx-1', status: 'running', agent: 'claude', ports: [], workspace: '/p' }] : []),
    setSecret: vi.fn(async () => {}), setCustomSecret: vi.fn(async () => {}), setRegistrySecret: vi.fn(async () => {}),
    execScript: vi.fn(async (_name: string, _script: string) => {}),
    listInstanceSecretsRaw: vi.fn(async (_name: string) => secretLs)
  }
  const store = { updateInstanceFingerprint: vi.fn() }
  const creds = { getStaged: vi.fn(() => 'secret-val') }
  return { adapter, store, creds, log: undefined }
}

describe('applyCredentialsLive', () => {
  it('registers values and injects the custom secret using its DYNAMIC placeholder from sbx secret ls', async () => {
    const d = deps()
    const r = await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: 'stale' })
    expect(d.adapter.setCustomSecret).toHaveBeenCalledWith(['api.acme.com'], 'ACME_KEY', 'secret-val', { sandbox: 'sbx-1' })
    expect(d.adapter.listInstanceSecretsRaw).toHaveBeenCalledWith('sbx-1')
    const script = d.adapter.execScript.mock.calls[0][1] as string
    expect(d.adapter.execScript.mock.calls[0][0]).toBe('sbx-1')
    expect(script).toContain("export ACME_KEY='sbx-cs-ACMEplaceholder01'")
    expect(script).not.toContain("export ACME_KEY='proxy-managed'") // never hardcoded for custom
    expect(d.store.updateInstanceFingerprint).toHaveBeenCalledWith('sbx-1', credFingerprint(base.credentials))
    expect(r).toEqual({ applied: 1, skipped: 0 })
  })

  it('omits a custom secret from the injected block when no placeholder is found for the scope', async () => {
    const d = deps(true, 'CUSTOM SECRETS\nSCOPE   TARGETS   ENV   PLACEHOLDER   SECRET\n') // no matching row
    await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: 'stale' })
    const script = d.adapter.execScript.mock.calls[0][1] as string
    expect(script).not.toContain('ACME_KEY') // not injected with a wrong/hardcoded value
  })

  it('throws when the sandbox is not running and writes nothing', async () => {
    const d = deps(false)
    await expect(applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec: base, storedFingerprint: null }))
      .rejects.toThrow(/not running/i)
    expect(d.adapter.execScript).not.toHaveBeenCalled()
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
      credentials: [
        ...base.credentials,
        { kind: 'registry', id: 'ghcr', host: 'ghcr.io', scope: 'sandbox', store: 'sbx' }
      ]
    }
    // stored fingerprint had NO registry entry → registry subset differs → drift must persist.
    await applyCredentialsLive(d as never, { name: 'sbx-1', definitionId: 'd1', spec, storedFingerprint: credFingerprint(base.credentials) })
    expect(d.adapter.execScript).toHaveBeenCalled() // service/custom still applied
    expect(d.adapter.setRegistrySecret).not.toHaveBeenCalled() // registry excluded from live registration
    const script = d.adapter.execScript.mock.calls[0][1] as string
    expect(script).not.toContain('ghcr') // registry never in the env block
    expect(d.store.updateInstanceFingerprint).not.toHaveBeenCalled() // drift persists
  })
})
