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

vi.mock('../../src/renderer/ipc/client', () => ({
  api: {
    prereqCheck: () => prereqCheck(),
    instancesList: () => instancesList(),
    defList: () => defList(),
    defCreate: async () => ({ ok: true, data: { id: 'id1' } }),
    instanceLaunch: (id: string) => instanceLaunch(id),
    instanceAttach: (n: string) => instanceAttach(n),
    instanceShell: (n: string) => instanceShell(n),
    instanceStop: (n: string) => instanceStop(n),
    instanceRemove: (n: string) => instanceRemove(n)
  }
}))

import App from '../../src/renderer/App'

const oneDef = { ok: true, data: [{ id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' }] }
const runningInst = { ok: true, data: [{ name: 'my-project', status: 'running', agent: 'Claude Code', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'My Project', tier: 'locked' }] }

beforeEach(() => {
  prereqCheck.mockReset(); instancesList.mockReset(); defList.mockReset()
  instanceLaunch.mockReset(); instanceAttach.mockReset(); instanceShell.mockReset(); instanceStop.mockReset(); instanceRemove.mockReset()
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
  it('Launch on a definition calls instanceLaunch', async () => {
    render(<App />)
    await screen.findByRole('button', { name: 'Launch' })
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(instanceLaunch).toHaveBeenCalledWith('d1'))
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

  it('Cancel on the remove dialog does not call instanceRemove', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sandbox instances/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(instanceRemove).not.toHaveBeenCalled()
  })
})
