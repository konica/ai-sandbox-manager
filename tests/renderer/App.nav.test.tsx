import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const prereqCheck = vi.fn()
const instancesList = vi.fn()
const defList = vi.fn()
vi.mock('../../src/renderer/ipc/client', () => ({
  api: {
    prereqCheck: () => prereqCheck(),
    instancesList: () => instancesList(),
    defList: () => defList(),
    defCreate: async () => ({ ok: true, data: { id: 'id1' } })
  }
}))

import App from '../../src/renderer/App'

beforeEach(() => {
  prereqCheck.mockReset(); instancesList.mockReset(); defList.mockReset()
  prereqCheck.mockResolvedValue({ ok: true, data: { ok: true, checks: [] } })
  instancesList.mockResolvedValue({ ok: true, data: [] })
  defList.mockResolvedValue({ ok: true, data: [] })
})

describe('App navigation', () => {
  it('lands on Definitions after the prereq gate passes', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Sandbox Definitions')).toBeInTheDocument())
  })

  it('navigates to Instances', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Sandbox Definitions')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /instances/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Instances' })).toBeInTheDocument())
  })

  it('opens the wizard from the create button and returns on cancel', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Sandbox Definitions')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /create definition/i }))
    await waitFor(() => expect(screen.getByText('Create Definition')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.getByText('Sandbox Definitions')).toBeInTheDocument())
  })
})
