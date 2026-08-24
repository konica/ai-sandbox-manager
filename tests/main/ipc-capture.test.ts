import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'
import { IDLE_STATUS } from '../../src/shared/capture'

function deps(over: Record<string, unknown> = {}) {
  const prefs = new Map<string, string>()
  const store = {
    getPref: (k: string) => prefs.get(k) ?? null,
    setPref: (k: string, v: string) => { prefs.set(k, v) }
  }
  const capture = {
    status: vi.fn(() => IDLE_STATUS),
    enable: vi.fn(async (name: string) => ({ sandbox: name, state: 'on', checks: [] })),
    disable: vi.fn(async () => IDLE_STATUS),
    onRunningInstances: vi.fn()
  }
  return { adapter: {} as never, store, probes: {} as never, openTerminal: vi.fn(), capture, ...over } as never
}

describe('capture IPC', () => {
  it('returns the current status', async () => {
    const h = buildHandlers(deps())
    expect(await h['capture:status']()).toEqual({ ok: true, data: IDLE_STATUS })
  })

  it('enables and disables a sandbox', async () => {
    const h = buildHandlers(deps())
    const r = await h['capture:enable']('demo', false)
    expect(r.ok && r.data.state).toBe('on')
    expect((await h['capture:disable']()).ok).toBe(true)
  })

  it('passes the force flag through for Enable anyway', async () => {
    const d = deps() as unknown as { capture: { enable: ReturnType<typeof vi.fn> } }
    const h = buildHandlers(d as never)
    await h['capture:enable']('demo', true)
    expect(d.capture.enable).toHaveBeenCalledWith('demo', { force: true })
  })

  it('round-trips Burp settings through app_prefs', async () => {
    const h = buildHandlers(deps())
    const first = await h['capture:settingsGet']()
    expect(first.ok && first.data.proxyPort).toBe(8080)
    const set = await h['capture:settingsSet']({ proxyPort: 9090, caPath: 'C:/ca.cer' })
    expect(set.ok && set.data.proxyPort).toBe(9090)
    const again = await h['capture:settingsGet']()
    expect(again.ok && again.data.caPath).toBe('C:/ca.cer')
  })

  it('reports an invalid port as an error result rather than throwing', async () => {
    const h = buildHandlers(deps())
    const r = await h['capture:settingsSet']({ proxyPort: 0 })
    expect(r.ok).toBe(false)
  })

  it('inspects a CA file and reports parse failures as error results', async () => {
    const good = buildHandlers(deps({ readCa: () => ({ pem: 'P', subject: 'CN=Burp', commonName: 'Burp', expires: '2036' }) }))
    const r = await good['capture:caInspect']('C:/ca.cer')
    expect(r.ok && r.data.commonName).toBe('Burp')

    const bad = buildHandlers(deps({ readCa: () => { throw new Error('not a valid certificate') } }))
    expect((await bad['capture:caInspect']('C:/x')).ok).toBe(false)
  })

  it('builds the Burp config from the configured upstream port', async () => {
    const h = buildHandlers(deps())
    await h['capture:settingsSet']({ upstreamPort: 3200 })
    const r = await h['capture:burpConfig']()
    expect(r.ok && JSON.parse(r.data).user_options.connections.upstream_proxy.servers[0].proxy_port).toBe(3200)
  })

  it('exports the config through the Save dialog and reports the path', async () => {
    const saveFile = vi.fn(async () => 'C:/out/burp-upstream-proxy.json')
    const h = buildHandlers(deps({ saveFile }))
    const r = await h['capture:exportConfig']()
    expect(r.ok && r.data.path).toBe('C:/out/burp-upstream-proxy.json')
    expect(saveFile).toHaveBeenCalledWith('burp-upstream-proxy.json', expect.stringContaining('upstream_proxy'))
  })

  it('reports a cancelled export rather than treating it as a failure', async () => {
    const h = buildHandlers(deps({ saveFile: vi.fn(async () => null) }))
    const r = await h['capture:exportConfig']()
    expect(r.ok && r.data.canceled).toBe(true)
  })

  it('reports a clear error when no capture session is wired', async () => {
    const h = buildHandlers(deps({ capture: undefined }))
    expect((await h['capture:enable']('demo', false)).ok).toBe(false)
  })
})
