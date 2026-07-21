import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const defCreate = vi.fn()
const credStageValue = vi.fn()
vi.mock('../../../src/renderer/ipc/client', () => ({ api: { defCreate: (s: unknown) => defCreate(s), pickFolder: async () => null, credScanEnv: async () => ({ ok: true, data: [] }), sshDetect: async () => ({ ok: true, data: { present: false } }), credStageValue: (k: string, v: string) => credStageValue(k, v) } }))

import { CreateDefinition, sshSummary } from '../../../src/renderer/wizard/CreateDefinition'

const tSsh = (k: string): string => ({ 'wizard.sshForwarded': 'Forwarded', 'wizard.sshOff': 'Off', 'wizard.sshPlusSigning': '+ commit signing' }[k] ?? k)

describe('sshSummary', () => {
  it('reflects forward/off and signing', () => {
    expect(sshSummary({ sshForwardAgent: true, sshCommitSigning: false }, tSsh)).toBe('Forwarded')
    expect(sshSummary({ sshForwardAgent: true, sshCommitSigning: true }, tSsh)).toBe('Forwarded + commit signing')
    expect(sshSummary({ sshForwardAgent: false, sshCommitSigning: false }, tSsh)).toBe('Off')
  })
})

beforeEach(() => {
  defCreate.mockReset(); defCreate.mockResolvedValue({ ok: true, data: { id: 'id1' } })
  credStageValue.mockReset(); credStageValue.mockResolvedValue({ ok: true, data: null })
})

describe('CreateDefinition wizard', () => {
  it('adds an extra folder (default read-only) and toggles its access to read-write', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Extra folder path'), { target: { value: '/home/u/shared' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }))
    const pill = screen.getByRole('button', { name: /home\/u\/shared: read-only/i })
    fireEvent.click(pill)
    expect(screen.getByRole('button', { name: /home\/u\/shared: read-write/i })).toBeInTheDocument()
  })
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

  it('adds a port on the Ports step and summarises it in Review with protocol', async () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} createId={() => 'id1'} now={() => '2026-07-18T00:00:00Z'} />)
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: /next/i })) // -> 5 ports
    fireEvent.change(screen.getByLabelText('Port mapping'), { target: { value: '8080:3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 5 -> 6 review
    expect(screen.getByText('8080→3000/tcp')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    await waitFor(() => expect(defCreate).toHaveBeenCalledOnce())
    expect(defCreate.mock.calls[0][0].ports[0]).toEqual({ hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: '' })
  })

  it('stages an entered service credential value on submit', async () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} createId={() => 'id1'} now={() => '2026-07-18T00:00:00Z'} />)
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'prj-alpha' } })
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /next/i })) // -> 4 credentials
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk-ant-xyz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 4 -> 5 ports
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 5 -> 6 review
    expect(screen.getByText(/Anthropic/)).toBeInTheDocument() // review summarises credentials by name
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    await waitFor(() => expect(credStageValue).toHaveBeenCalledWith('id1:service:anthropic', 'sk-ant-xyz'))
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
