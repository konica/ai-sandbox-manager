import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { InstanceView } from '../../../src/shared/types'
import type { CaptureStatus } from '../../../src/shared/capture'

const IDLE: CaptureStatus = { sandbox: null, state: 'off', checks: [] }
const ON: CaptureStatus = {
  sandbox: 'sbx-a',
  state: 'on',
  checks: [],
  ports: { proxy: 8080, upstream: 3128, relay: 3129, app: 18080 }
}

// Mutable so a test can flip capture on mid-render, the way enabling the toggle does.
const state = vi.hoisted(() => ({ capture: { sandbox: null, state: 'off', checks: [] } as CaptureStatus }))

const api = vi.hoisted(() => ({
  captureStatus: vi.fn(),
  captureSettingsGet: vi.fn(async () => ({ ok: true, data: { caPath: 'C:/ca.cer', proxyPort: 8080, upstreamPort: 3128 } })),
  captureEnable: vi.fn(), captureDisable: vi.fn(),
  // The command embeds the capture port, so main returns a different string once capture is on.
  instanceCommands: vi.fn(),
  defGetSpec: vi.fn(async () => ({ ok: true, data: null })),
  instancePortsList: vi.fn(async () => ({ ok: true, data: [] })),
  instancePolicyLog: vi.fn(async () => ({ ok: true, data: { allowed: 0, blocked: 0, events: [] } })),
  instanceStats: vi.fn(async () => ({ ok: false, error: { kind: 'generic', message: 'x' } })),
  prefsGet: vi.fn(async () => ({ ok: true, data: null })),
  prefsSet: vi.fn(async () => ({ ok: true, data: null }))
}))
vi.mock('../../../src/renderer/ipc/client', () => ({ api }))

import { InstanceDetail } from '../../../src/renderer/screens/InstanceDetail'

const inst: InstanceView = { name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId: null, definitionName: null, tier: 'locked', tags: [], createdAt: null }
const base = { onBack: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(), onRebuild: vi.fn(), onApplyCredentials: vi.fn(), onAttach: vi.fn(), onShell: vi.fn(), onSetTags: vi.fn() }

const PLAIN = "sbx exec -it 'sbx-a' bash"
const INJECTED = "sbx exec -it -e http_proxy=http://127.0.0.1:18080 -e https_proxy=http://127.0.0.1:18080 'sbx-a' bash"

beforeEach(() => {
  vi.clearAllMocks()
  state.capture = IDLE
  api.captureStatus.mockImplementation(async () => ({ ok: true, data: state.capture }))
  api.instanceCommands.mockImplementation(async () => ({
    ok: true,
    data: { agent: 'sbx run --name sbx-a', shell: state.capture.state === 'on' ? INJECTED : PLAIN }
  }))
})
afterEach(() => vi.useRealTimers())

describe('the copyable shell command tracks capture state', () => {
  it('shows the plain command while capture is off', async () => {
    render(<InstanceDetail instance={inst} {...base} />)
    await waitFor(() => expect(screen.getByTitle(PLAIN)).toBeInTheDocument())
  })

  it('re-fetches the command when capture turns on, without leaving the Terminals tab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<InstanceDetail instance={inst} {...base} />)
    await waitFor(() => expect(api.instanceCommands).toHaveBeenCalledTimes(1))

    // The toggle lives on Monitoring, but the command is copied from Terminals. Capture
    // status must therefore be tracked regardless of which tab is open, or the user copies
    // a stale command that silently bypasses Burp.
    state.capture = ON
    await vi.advanceTimersByTimeAsync(5100)

    await waitFor(() => expect(api.instanceCommands).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTitle(INJECTED)).toBeInTheDocument())
  })

  it('reverts to the plain command when capture is disabled again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<InstanceDetail instance={inst} {...base} />)
    state.capture = ON
    await vi.advanceTimersByTimeAsync(5100)
    await waitFor(() => expect(screen.getByTitle(INJECTED)).toBeInTheDocument())

    state.capture = IDLE
    await vi.advanceTimersByTimeAsync(5100)
    await waitFor(() => expect(screen.getByTitle(PLAIN)).toBeInTheDocument())
  })

  it('does not re-fetch when capture is on for a DIFFERENT sandbox', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<InstanceDetail instance={inst} {...base} />)
    await waitFor(() => expect(api.instanceCommands).toHaveBeenCalledTimes(1))

    state.capture = { ...ON, sandbox: 'someone-else' }
    await vi.advanceTimersByTimeAsync(5100)
    await vi.advanceTimersByTimeAsync(5100)
    expect(api.instanceCommands).toHaveBeenCalledTimes(1)
  })
})
