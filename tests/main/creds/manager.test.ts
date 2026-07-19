import { describe, it, expect, vi } from 'vitest'
import { createCredentialManager } from '../../../src/main/creds/manager'
import { createMemoryVault } from '../../../src/main/creds/vault'

function fakes() {
  const adapter = { setSecret: vi.fn(async () => {}), removeSecret: vi.fn(async () => {}) }
  const gs: any[] = []
  const store = {
    upsertGlobalSecret: vi.fn((g: any) => { const i = gs.findIndex((x) => x.id === g.id); i >= 0 ? (gs[i] = g) : gs.push(g) }),
    deleteGlobalSecret: vi.fn((id: string) => { const i = gs.findIndex((x) => x.id === id); if (i >= 0) gs.splice(i, 1) }),
    listGlobalSecrets: vi.fn(() => gs)
  }
  return { adapter, store, vault: createMemoryVault(), now: () => 1_752_000_000_000 }
}

describe('CredentialManager', () => {
  it('setGlobalService pipes to sbx -g and records meta', async () => {
    const f = fakes()
    const m = createCredentialManager(f as any)
    const meta = await m.setGlobalService('anthropic', 'sk-ant-x')
    expect(f.adapter.setSecret).toHaveBeenCalledWith('anthropic', 'sk-ant-x', { global: true })
    expect(meta).toMatchObject({ id: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' })
    expect(f.store.upsertGlobalSecret).toHaveBeenCalled()
    expect(m.listGlobalSecrets()).toHaveLength(1)
  })
  it('removeGlobalSecret removes from sbx and store', async () => {
    const f = fakes()
    const m = createCredentialManager(f as any)
    await m.setGlobalService('github', 'gho_x')
    await m.removeGlobalSecret('github')
    expect(f.adapter.removeSecret).toHaveBeenCalledWith('github', { global: true })
    expect(m.listGlobalSecrets()).toHaveLength(0)
  })
  it('stages a per-definition value and reads it repeatedly (relaunch-safe, not consumed)', () => {
    const f = fakes()
    const m = createCredentialManager(f as any)
    m.stageValue('d1:service:openai', 'v')
    expect(m.getStaged('d1:service:openai')).toBe('v')
    expect(m.getStaged('d1:service:openai')).toBe('v') // still there for the next launch
    expect(m.getStaged('d1:service:missing')).toBeNull()
  })
  it('rejects an unknown service', async () => {
    const f = fakes()
    const m = createCredentialManager(f as any)
    await expect(m.setGlobalService('nope', 'x')).rejects.toThrow(/unknown service/)
  })
})
