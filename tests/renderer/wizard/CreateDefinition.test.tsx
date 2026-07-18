import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const defCreate = vi.fn()
vi.mock('../../../src/renderer/ipc/client', () => ({ api: { defCreate: (s: unknown) => defCreate(s) } }))

import { CreateDefinition } from '../../../src/renderer/wizard/CreateDefinition'

beforeEach(() => { defCreate.mockReset(); defCreate.mockResolvedValue({ ok: true, data: { id: 'id1' } }) })

function fillNameAndAdvance() {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'prj-alpha' } })
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
}

describe('CreateDefinition wizard', () => {
  it('disables Next on step 1 until a name is entered', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('walks to the review step and submits a spec via defCreate', async () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} createId={() => 'id1'} now={() => '2026-07-18T00:00:00Z'} />)
    // Step 1 -> 2
    fillNameAndAdvance()
    // Step 2 (base image default is valid) -> 3
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Step 3 needs a workspace
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Steps 4,5,6 optional
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 4->5
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 5->6
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 6->7
    // Step 7 review -> create
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    await waitFor(() => expect(defCreate).toHaveBeenCalledOnce())
    const arg = defCreate.mock.calls[0][0]
    expect(arg.definition).toMatchObject({ id: 'id1', name: 'prj-alpha', baseImage: 'docker.io/docker/sandbox-templates:claude-code-docker', tier: 'locked' })
    expect(arg.mounts[0]).toEqual({ hostPath: '/home/u/alpha', mode: 'direct', isPrimary: true })
  })

  it('shows the direct-mode warning on the workspace step', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    fillNameAndAdvance()
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 2->3
    expect(screen.getByText(/git hooks|implicit|makefile/i)).toBeInTheDocument()
  })
})
