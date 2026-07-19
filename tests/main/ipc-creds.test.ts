import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'

function deps() {
  const gs = [{ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: 't' }]
  const creds = {
    listGlobalSecrets: vi.fn(() => gs),
    setGlobalService: vi.fn(async (id: string) => ({ id, label: 'X', envVar: 'X_KEY', store: 'sbx', createdAt: 't' })),
    removeGlobalSecret: vi.fn(async () => {}),
    stageServiceValue: vi.fn(),
    stageCustomValue: vi.fn()
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
})
