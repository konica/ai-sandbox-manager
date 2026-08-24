import { describe, it, expect, vi } from 'vitest'
import { buildHandlers } from '../../src/main/ipc'
import { IDLE_STATUS, type CaptureStatus } from '../../src/shared/capture'

const ON: CaptureStatus = {
  sandbox: 'demo',
  state: 'on',
  checks: [],
  ports: { proxy: 8080, upstream: 3128, relay: 3129, app: 18080 }
}

function deps(status: CaptureStatus, openTerminal = vi.fn()) {
  return {
    adapter: { listSandboxes: async () => [] },
    store: { listInstanceMeta: () => [], getDefinitionSpec: () => null },
    probes: {},
    openTerminal,
    capture: { status: () => status, enable: vi.fn(), disable: vi.fn(), onRunningInstances: vi.fn() }
  } as never
}

describe('shell command while capture is off', () => {
  it('is unchanged — no proxy env is injected', async () => {
    const h = buildHandlers(deps(IDLE_STATUS))
    const r = await h['instance:commands']('demo')
    expect(r.ok && r.data.shell).toBe("sbx exec -it 'demo' bash")
  })
})

describe('shell command while capturing THIS sandbox', () => {
  it('injects the capture proxy so a new shell is actually captured', async () => {
    const h = buildHandlers(deps(ON))
    const r = await h['instance:commands']('demo')
    expect(r.ok && r.data.shell).toContain('-e http_proxy=http://127.0.0.1:18080')
  })

  it('opens the terminal with the injected command too', async () => {
    const openTerminal = vi.fn()
    const h = buildHandlers(deps(ON, openTerminal))
    await h['instance:shell']('demo')
    expect(openTerminal).toHaveBeenCalledWith(expect.stringContaining('-e http_proxy=http://127.0.0.1:18080'))
  })

  it('uses the port the session actually chose, not a hard-coded default', async () => {
    const shifted = { ...ON, ports: { ...ON.ports!, app: 18083 } }
    const h = buildHandlers(deps(shifted))
    const r = await h['instance:commands']('demo')
    expect(r.ok && r.data.shell).toContain('-e http_proxy=http://127.0.0.1:18083')
  })
})

describe('shell command while capturing a DIFFERENT sandbox', () => {
  // Only one capture session exists, so a sibling sandbox must not be handed a proxy
  // pointing at a relay that does not exist inside it — that would break its egress.
  it('leaves the other sandbox untouched', async () => {
    const h = buildHandlers(deps(ON))
    const r = await h['instance:commands']('other')
    expect(r.ok && r.data.shell).toBe("sbx exec -it 'other' bash")
  })
})

describe('shell command when capture is starting or errored', () => {
  it('does not inject until the session is actually on', async () => {
    const starting: CaptureStatus = { ...ON, state: 'starting', phase: 'tunnel' }
    const h = buildHandlers(deps(starting))
    const r = await h['instance:commands']('demo')
    expect(r.ok && r.data.shell).toBe("sbx exec -it 'demo' bash")
  })
})

describe('shell command with no capture session wired', () => {
  it('falls back to the plain command rather than throwing', async () => {
    const d = deps(IDLE_STATUS) as unknown as Record<string, unknown>
    delete d.capture
    const h = buildHandlers(d as never)
    const r = await h['instance:commands']('demo')
    expect(r.ok && r.data.shell).toBe("sbx exec -it 'demo' bash")
  })
})
