import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const prereqCheck = vi.fn()
const instancesList = vi.fn()
vi.mock('../../src/renderer/ipc/client', () => ({ api: { prereqCheck: () => prereqCheck(), instancesList: () => instancesList() } }))

import App from '../../src/renderer/App'

beforeEach(() => { prereqCheck.mockReset(); instancesList.mockReset() })

describe('App', () => {
  it('shows the Prereq screen when prerequisites fail', async () => {
    prereqCheck.mockResolvedValue({ ok: true, data: { ok: false, checks: [{ id: 'auth', label: 'sbx authentication', ok: false, detail: 'no', remediation: 'Run `sbx login`' }] } })
    render(<App />)
    await waitFor(() => expect(screen.getByText('System Prerequisites')).toBeInTheDocument())
    expect(instancesList).not.toHaveBeenCalled()
  })

  it('shows Instances when prerequisites pass', async () => {
    prereqCheck.mockResolvedValue({ ok: true, data: { ok: true, checks: [] } })
    instancesList.mockResolvedValue({ ok: true, data: [{ name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/w', ports: [], definitionId: null, definitionName: null, tier: 'custom' }] })
    render(<App />)
    await waitFor(() => expect(screen.getByText('Instances')).toBeInTheDocument())
    expect(screen.getByText('sbx-a')).toBeInTheDocument()
  })
})
