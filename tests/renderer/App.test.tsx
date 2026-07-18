import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const prereqCheck = vi.fn()
const instancesList = vi.fn()
const defList = vi.fn()
vi.mock('../../src/renderer/ipc/client', () => ({ api: {
  prereqCheck: () => prereqCheck(), instancesList: () => instancesList(), defList: () => defList(),
  defCreate: async () => ({ ok: true, data: { id: 'id1' } })
} }))

import App from '../../src/renderer/App'

beforeEach(() => {
  prereqCheck.mockReset(); instancesList.mockReset(); defList.mockReset()
  instancesList.mockResolvedValue({ ok: true, data: [] })
  defList.mockResolvedValue({ ok: true, data: [] })
})

describe('App', () => {
  it('shows the Prereq screen when prerequisites fail', async () => {
    prereqCheck.mockResolvedValue({ ok: true, data: { ok: false, checks: [{ id: 'auth', label: 'sbx authentication', ok: false, detail: 'no', remediation: 'Run `sbx login`' }] } })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'System Prerequisites' })).toBeInTheDocument())
  })

  it('shows Definitions when prerequisites pass', async () => {
    prereqCheck.mockResolvedValue({ ok: true, data: { ok: true, checks: [] } })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sandbox Definitions' })).toBeInTheDocument())
  })
})
