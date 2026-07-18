import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const defCreate = vi.fn()
vi.mock('../../../src/renderer/ipc/client', () => ({ api: { defCreate: (s: unknown) => defCreate(s), pickFolder: async () => null } }))

import { CreateDefinition } from '../../../src/renderer/wizard/CreateDefinition'

beforeEach(() => { defCreate.mockReset(); defCreate.mockResolvedValue({ ok: true, data: { id: 'id1' } }) })

describe('CreateDefinition wizard', () => {
  it('disables Next on step 1 until a working directory is entered', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('walks to the review step and submits a spec via defCreate', async () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} createId={() => 'id1'} now={() => '2026-07-18T00:00:00Z'} />)
    // Step 1 (merged name + workspace): name optional, workspace required
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'prj-alpha' } })
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 1 -> 2 base image
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 2 -> 3 network
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 3 -> 4 ports
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 4 -> 5 credentials
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 5 -> 6 review
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    await waitFor(() => expect(defCreate).toHaveBeenCalledOnce())
    const arg = defCreate.mock.calls[0][0]
    expect(arg.definition).toMatchObject({ id: 'id1', name: 'prj-alpha', baseImage: 'docker.io/docker/sandbox-templates:claude-code', tier: 'locked' })
    expect(arg.mounts[0]).toEqual({ hostPath: '/home/u/alpha', mode: 'direct', isPrimary: true })
  })

  it('derives the sandbox name from the working directory when name is blank', async () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} createId={() => 'id1'} now={() => '2026-07-18T00:00:00Z'} />)
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/my-project' } })
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    await waitFor(() => expect(defCreate).toHaveBeenCalledOnce())
    expect(defCreate.mock.calls[0][0].definition.name).toBe('my-project')
  })

  it('shows the direct-mode warning on the merged first step', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    expect(screen.getByText(/git hooks|implicit|makefile/i)).toBeInTheDocument()
  })
})
