import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const prereqCheck = vi.fn()
const instancesList = vi.fn()
const defList = vi.fn()
const instanceLaunch = vi.fn()
const instanceAttach = vi.fn()
const instanceShell = vi.fn()
const instanceStop = vi.fn()
const instanceRemove = vi.fn()
const authStartLogin = vi.fn()

vi.mock('../../src/renderer/ipc/client', () => ({
  api: {
    prereqCheck: () => prereqCheck(),
    instancesList: () => instancesList(),
    defList: () => defList(),
    defCreate: async () => ({ ok: true, data: { id: 'id1' } }),
    defGetSpec: async () => ({ ok: true, data: { definition: { id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] } }),
    instanceLaunch: (id: string, name?: string, session?: string, opener?: string) => instanceLaunch(id, name, session, opener),
    instanceAttach: (n: string, opener?: string) => instanceAttach(n, opener),
    instanceShell: (n: string) => instanceShell(n),
    instanceStop: (n: string) => instanceStop(n),
    instanceRemove: (n: string) => instanceRemove(n),
    authStartLogin: () => authStartLogin(),
    envHasVSCode: async () => ({ ok: true, data: { present: true } })
  }
}))

import App from '../../src/renderer/App'

const oneDef = { ok: true, data: [{ id: 'd1', name: 'My Project', description: '', agent: 'claude', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' }] }
const runningInst = { ok: true, data: [{ name: 'my-project', status: 'running', agent: 'Claude Code', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'My Project', tier: 'locked', tags: [] }] }

beforeEach(() => {
  prereqCheck.mockReset(); instancesList.mockReset(); defList.mockReset()
  instanceLaunch.mockReset(); instanceAttach.mockReset(); instanceShell.mockReset(); instanceStop.mockReset(); instanceRemove.mockReset()
  authStartLogin.mockReset().mockResolvedValue({ ok: true, data: { name: 'sbx-oauth-login' } })
  prereqCheck.mockResolvedValue({ ok: true, data: { ok: true, checks: [] } })
  instancesList.mockResolvedValue(runningInst)
  defList.mockResolvedValue(oneDef)
  instanceLaunch.mockResolvedValue({ ok: true, data: { name: 'my-project' } })
  instanceAttach.mockResolvedValue({ ok: true, data: null })
  instanceShell.mockResolvedValue({ ok: true, data: null })
  instanceStop.mockResolvedValue({ ok: true, data: null })
  instanceRemove.mockResolvedValue({ ok: true, data: null })
})

describe('App launch & lifecycle wiring', () => {
  it('Launch opens a dialog; submitting calls instanceLaunch with the session name (sandbox auto)', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Launch' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Session name'), { target: { value: 'Refactor auth' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(instanceLaunch).toHaveBeenCalledWith('d1', undefined, 'Refactor auth', 'vscode'))
  })

  it('launches directly (no sign-in nudge) even when Claude has no credential', async () => {
    // defGetSpec mock returns a definition with no credentials → previously this popped the
    // OAuth nudge; now launch goes straight to the dialog (sign-in happens in-session).
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Launch' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Session name')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in when it opens/i })).not.toBeInTheDocument()
  })

  it('surfaces the error message when launch fails', async () => {
    instanceLaunch.mockResolvedValue({ ok: false, error: { kind: 'not-found', message: 'sbx create failed: boom' } })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Launch' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(screen.getByText(/sbx create failed: boom/)).toBeInTheDocument())
  })

  it('Remove asks for confirmation before calling instanceRemove', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sandbox instances/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    // modal is open; remove not yet called
    expect(instanceRemove).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(instanceRemove).toHaveBeenCalledWith('my-project'))
  })

  it('Stop asks for confirmation before calling instanceStop', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sandbox instances/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(instanceStop).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(instanceStop).toHaveBeenCalledWith('my-project'))
  })

  it('Cancel on the remove dialog does not call instanceRemove', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sandbox instances/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(instanceRemove).not.toHaveBeenCalled()
  })
})
