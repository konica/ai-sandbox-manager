import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const instancesList = vi.fn()
const instanceRebuild = vi.fn()

vi.mock('../../src/renderer/ipc/client', () => ({
  api: {
    prereqCheck: async () => ({ ok: true, data: { ok: true, checks: [] } }),
    instancesList: () => instancesList(),
    defList: async () => ({ ok: true, data: [] }),
    instanceRebuild: (n: string, opener?: string, preserve?: boolean) => instanceRebuild(n, opener, preserve),
    envHasVSCode: async () => ({ ok: true, data: { present: false } }),
    mcpList: async () => ({ ok: true, data: [] }),
    sessionListArchives: async () => ({ ok: true, data: [] }),
    // Stubs the instance detail view needs on mount.
    prefsGet: async () => ({ ok: true, data: null }),
    prefsSet: async () => ({ ok: true, data: null }),
    defGetSpec: async () => ({ ok: true, data: null }),
    instanceCommands: async () => ({ ok: true, data: { agent: 'a', shell: 's' } }),
    instancePortsList: async () => ({ ok: true, data: [] }),
    instancePolicyLog: async () => ({ ok: true, data: { allowed: 0, blocked: 0, events: [] } }),
    instanceStats: async () => ({ ok: false, error: { kind: 'generic', message: 'x' } }),
    captureStatus: async () => ({ ok: true, data: { state: 'off' } }),
    captureSettingsGet: async () => ({ ok: true, data: { caPath: '', proxyPort: 8080, upstreamPort: 3128 } })
  }
}))

import App from '../../src/renderer/App'

const INSTANCE = {
  name: 'xray-old', status: 'running', agent: 'claude', workspace: '/w/xray', ports: [],
  definitionId: 'd1', definitionName: 'xray', tier: 'open', tags: [], createdAt: null
}

beforeEach(() => {
  vi.clearAllMocks()
  instancesList.mockResolvedValue({ ok: true, data: [INSTANCE] })
  instanceRebuild.mockResolvedValue({ ok: true, data: { name: 'xray-new' } })
})

/** Open the instance detail, then its rebuild confirmation. */
async function openRebuildDialog(): Promise<void> {
  render(<App />)
  // The app opens on Definitions; the rebuild action lives on an instance's detail view.
  fireEvent.click(await screen.findByRole('button', { name: /Sandbox Instances/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'xray-old' }))
  fireEvent.click(await screen.findByRole('button', { name: /rebuild/i }))
  await screen.findByRole('checkbox')
}

describe('rebuild preserve-sessions choice', () => {
  it('preserves sessions by default', async () => {
    await openRebuildDialog()

    fireEvent.click(screen.getByRole('button', { name: /^rebuild$/i }))

    await waitFor(() => expect(instanceRebuild).toHaveBeenCalledWith('xray-old', expect.anything(), true))
  })

  it('passes preserve=false when the box is unchecked', async () => {
    await openRebuildDialog()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^rebuild$/i }))

    await waitFor(() => expect(instanceRebuild).toHaveBeenCalledWith('xray-old', expect.anything(), false))
  })

  it('starts checked, so the safe choice is the default one', async () => {
    await openRebuildDialog()

    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('re-checks the box for the next rebuild after being unchecked', async () => {
    // The choice is per-rebuild, not sticky — an unchecked run must not silently make every
    // later rebuild discard its history.
    await openRebuildDialog()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^rebuild$/i }))
    await waitFor(() => expect(instanceRebuild).toHaveBeenCalled())

    fireEvent.click(await screen.findByRole('button', { name: 'xray-old' }))
    fireEvent.click(await screen.findByRole('button', { name: /rebuild/i }))

    expect(await screen.findByRole('checkbox')).toBeChecked()
  })
})
