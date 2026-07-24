import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'

function deps() {
  const gs = [{ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: 't' }]
  const creds = {
    listGlobalSecrets: vi.fn(() => gs),
    setGlobalService: vi.fn(async (id: string) => ({ id, label: 'X', envVar: 'X_KEY', store: 'sbx', createdAt: 't' })),
    removeGlobalSecret: vi.fn(async () => {}),
    stageValue: vi.fn(),
    getStaged: vi.fn(() => null)
  }
  return {
    adapter: {} as never, store: {} as never, probes: {} as never, openTerminal: vi.fn(),
    creds, readLoginEnv: () => ({ ANTHROPIC_API_KEY: 'sk-ant-xyz' })
  } as never
}

describe('credential IPC handlers', () => {
  it('lists, sets, removes global secrets', async () => {
    const h = buildHandlers(deps())
    expect((await h['secret:listGlobal']()).ok).toBe(true)
    const set = await h['secret:setGlobal']('anthropic', 'sk')
    expect(set.ok).toBe(true)
    expect((await h['secret:removeGlobal']('openai')).ok).toBe(true)
  })
  it('scans env and stages a value', async () => {
    const h = buildHandlers(deps())
    const scan = await h['cred:scanEnv']()
    expect(scan.ok && scan.data.some((x) => x.serviceId === 'anthropic')).toBe(true)
    expect((await h['cred:stageValue']('service:openai', 'v')).ok).toBe(true)
  })
  it('stages an imported credential\'s REAL value read from the host env', async () => {
    const d = deps()
    const h = buildHandlers(d)
    const r = await h['cred:stageFromEnv']('d1:service:anthropic', 'anthropic')
    expect(r.ok).toBe(true)
    expect((d as { creds: { stageValue: ReturnType<typeof vi.fn> } }).creds.stageValue).toHaveBeenCalledWith('d1:service:anthropic', 'sk-ant-xyz')
  })
  it('fails clearly when the imported service has no env value', async () => {
    const h = buildHandlers(deps())
    const r = await h['cred:stageFromEnv']('d1:service:openai', 'openai') // not in the fake env
    expect(r.ok).toBe(false)
  })
  it('sets a global secret from the host env value', async () => {
    const d = deps()
    const h = buildHandlers(d)
    const r = await h['secret:setGlobalFromEnv']('anthropic')
    expect(r.ok).toBe(true)
    expect((d as { creds: { setGlobalService: ReturnType<typeof vi.fn> } }).creds.setGlobalService).toHaveBeenCalledWith('anthropic', 'sk-ant-xyz')
  })
  it('errors when the imported service has no env value', async () => {
    const h = buildHandlers(deps())
    const r = await h['secret:setGlobalFromEnv']('openai') // not in the fake env
    expect(r.ok).toBe(false)
  })
})
