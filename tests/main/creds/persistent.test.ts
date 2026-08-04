import { describe, it, expect } from 'vitest'
import {
  credentialEnvVars, buildManagedBlock, persistentEnvScript, registrySubset,
  MANAGED_BEGIN, MANAGED_END, DEFAULT_SENTINEL
} from '../../../src/main/creds/persistent'
import type { CredentialRef } from '../../../src/shared/types'

const svc: CredentialRef = { kind: 'service', serviceId: 'github', envVar: 'GH_TOKEN', store: 'sbx' }
const custom: CredentialRef = { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], store: 'encrypted' }
const registry: CredentialRef = { kind: 'registry', id: 'ghcr', host: 'ghcr.io', scope: 'sandbox', store: 'sbx' }

describe('credentialEnvVars', () => {
  it('expands a service to ALL of its known env vars with the sentinel value', () => {
    expect(credentialEnvVars(svc)).toEqual([
      { name: 'GH_TOKEN', value: DEFAULT_SENTINEL },
      { name: 'GITHUB_TOKEN', value: DEFAULT_SENTINEL }
    ])
  })
  it('maps a custom cred to its single env var', () => {
    expect(credentialEnvVars(custom)).toEqual([{ name: 'ACME_KEY', value: DEFAULT_SENTINEL }])
  })
  it('returns nothing for a registry cred (no in-VM env var)', () => {
    expect(credentialEnvVars(registry)).toEqual([])
  })
})

describe('buildManagedBlock', () => {
  it('emits a sorted, deduped, delimited block of exports', () => {
    const block = buildManagedBlock([custom, svc])
    expect(block).toBe(
      [MANAGED_BEGIN,
        "export ACME_KEY='proxy-managed'",
        "export GH_TOKEN='proxy-managed'",
        "export GITHUB_TOKEN='proxy-managed'",
        MANAGED_END].join('\n')
    )
  })
  it('is empty (markers only) when no live-applicable creds', () => {
    expect(buildManagedBlock([registry])).toBe([MANAGED_BEGIN, MANAGED_END].join('\n'))
  })
})

describe('persistentEnvScript', () => {
  it('touches the file, deletes any prior managed block, then appends the new one via heredoc', () => {
    const s = persistentEnvScript([svc], '/etc/sandbox-persistent.sh')
    expect(s).toContain('touch /etc/sandbox-persistent.sh')
    expect(s).toContain("sed -i '/^# >>> sandbox-manager (managed) >>>$/,/^# <<< sandbox-manager (managed) <<<$/d' /etc/sandbox-persistent.sh")
    expect(s).toContain("cat >> /etc/sandbox-persistent.sh <<'SBXMGR_EOF'")
    expect(s).toContain("export GH_TOKEN='proxy-managed'")
    expect(s.trimEnd().endsWith('SBXMGR_EOF')).toBe(true)
  })
  it('guards against a missing trailing newline before appending the managed block', () => {
    const s = persistentEnvScript([svc], '/etc/sandbox-persistent.sh')
    expect(s).toContain('tail -c1')
    const guardIdx = s.indexOf('tail -c1')
    const catIdx = s.indexOf("cat >> /etc/sandbox-persistent.sh <<'SBXMGR_EOF'")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(catIdx)
  })
})

describe('registrySubset', () => {
  it('keeps only registry: entries, order-independent', () => {
    const fp = 'custom:ACME_KEY:api.acme.com|registry:ghcr.io:sandbox|service:github:GH_TOKEN'
    expect(registrySubset(fp)).toBe('registry:ghcr.io:sandbox')
  })
  it('returns empty string when there are no registry entries', () => {
    expect(registrySubset('service:github:GH_TOKEN')).toBe('')
  })
})
