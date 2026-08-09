import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const defCreate = vi.fn()
const defUpdate = vi.fn()
const credStageValue = vi.fn()
const prefsGet = vi.fn(async (_key: string) => ({ ok: true, data: 'balanced' }))
vi.mock('../../../src/renderer/ipc/client', () => ({ api: { defCreate: (s: unknown) => defCreate(s), defUpdate: (s: unknown) => defUpdate(s), pickFolder: async () => null, credScanEnv: async () => ({ ok: true, data: [] }), sshDetect: async () => ({ ok: true, data: { present: false } }), credStageValue: (k: string, v: string) => credStageValue(k, v), kitValidate: async () => ({ ok: true, data: { status: 'valid', message: 'ok' } }), prefsGet: (k: string) => prefsGet(k) } }))

import { CreateDefinition, sshSummary, stageErrorMessage } from '../../../src/renderer/wizard/CreateDefinition'

const tSsh = (k: string): string => ({ 'wizard.sshForwarded': 'Forwarded', 'wizard.sshOff': 'Off', 'wizard.sshPlusSigning': '+ commit signing' }[k] ?? k)

describe('sshSummary', () => {
  it('reflects forward/off and signing', () => {
    expect(sshSummary({ sshForwardAgent: true, sshCommitSigning: false }, tSsh)).toBe('Forwarded')
    expect(sshSummary({ sshForwardAgent: true, sshCommitSigning: true }, tSsh)).toBe('Forwarded + commit signing')
    expect(sshSummary({ sshForwardAgent: false, sshCommitSigning: false }, tSsh)).toBe('Off')
  })
})

describe('stageErrorMessage', () => {
  const t = (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k)
  it('maps insecure-storage to the friendly key', () => {
    expect(stageErrorMessage({ kind: 'insecure-storage', message: 'x' }, t)).toBe('wizard.insecureStorage')
  })
  it('falls back to stageFailed with the raw message', () => {
    expect(stageErrorMessage({ kind: 'generic', message: 'boom' }, t)).toBe('wizard.stageFailed:{"message":"boom"}')
  })
})

beforeEach(() => {
  defCreate.mockReset(); defCreate.mockResolvedValue({ ok: true, data: { id: 'id1' } })
  defUpdate.mockReset(); defUpdate.mockResolvedValue({ ok: true, data: { id: 'd1' } })
  credStageValue.mockReset(); credStageValue.mockResolvedValue({ ok: true, data: null })
  prefsGet.mockReset(); prefsGet.mockResolvedValue({ ok: true, data: 'balanced' })
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
  const editSpec = { definition: { id: 'd1', name: 'full-stack-project-template', description: '', agent: 'claude' as const, baseImage: 'img:tag', tier: 'locked' as const, createdAt: 't' }, mounts: [{ hostPath: '/p', mode: 'direct' as const, isPrimary: true }], domains: [], ports: [], hostServices: [], credentials: [] }

  it('jumps to a step when its header is clicked — edit mode only', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /base image/i }))
    expect(await screen.findByLabelText(/built-in templates/i)).toBeInTheDocument()
  })
  it('does not make step headers clickable when creating', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('button', { name: /base image/i })).toBeNull()
  })
  it('blocks navigation and does not save when the working directory is cleared (edit mode)', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i })) // attempt to leave step 1
    expect(await screen.findByText(/working directory is required/i)).toBeInTheDocument()
    expect(defUpdate).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/workspace/i)).toBeInTheDocument() // still on step 1
  })

  it('auto-saves the current draft when leaving a step in edit mode', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'edited desc' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 1 -> 2, auto-save
    await waitFor(() => expect(defUpdate).toHaveBeenCalled())
    expect(defUpdate.mock.calls[0][0].definition).toMatchObject({ id: 'd1', description: 'edited desc' })
    expect(await screen.findByText(/saved/i)).toBeInTheDocument()
  })

  it('does NOT auto-save on navigation in create mode', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 1 -> 2
    expect(defUpdate).not.toHaveBeenCalled()
    expect(defCreate).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/built-in templates/i)).toBeInTheDocument() // advanced to step 2
  })

  it('header-jump auto-saves in edit mode', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /ports/i })) // header jump to Ports
    await waitFor(() => expect(defUpdate).toHaveBeenCalled())
  })

  it('blocks navigation + auto-save when the Advanced kit YAML is unparseable (edit mode)', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /advanced/i })) // jump to Advanced (auto-saves current valid draft)
    await waitFor(() => expect(defUpdate).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Custom kit YAML'), { target: { value: 'commands: [oops' } })
    fireEvent.click(screen.getByRole('button', { name: /review/i })) // try to leave Advanced
    expect(await screen.findByText(/kit YAML is invalid/i)).toBeInTheDocument()
    expect(defUpdate).toHaveBeenCalledTimes(1) // no second save; navigation aborted
  })
  it('shows the sandbox name in the title when editing', () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('heading', { name: /edit sandbox: full-stack-project-template/i })).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 5 -> 6 advanced
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 6 -> 7 review
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
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 5 -> 6 advanced
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 6 -> 7 review
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
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 5 -> 6 advanced
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 6 -> 7 review
    expect(screen.getByText(/Anthropic/)).toBeInTheDocument() // review summarises credentials by name
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    await waitFor(() => expect(credStageValue).toHaveBeenCalledWith('id1:service:anthropic', 'sk-ant-xyz'))
  })

  it('derives the sandbox name from the working directory when name is blank', async () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} createId={() => 'id1'} now={() => '2026-07-18T00:00:00Z'} />)
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/my-project' } })
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    await waitFor(() => expect(defCreate).toHaveBeenCalledOnce())
    expect(defCreate.mock.calls[0][0].definition.name).toBe('my-project')
  })

  it('blocks submit when the Advanced kit YAML is unparseable', async () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} createId={() => 'id1'} now={() => 't'} />)
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: /next/i })) // → step 6 Advanced
    fireEvent.change(screen.getByLabelText('Custom kit YAML'), { target: { value: 'commands: [oops' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // → step 7 Review
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    expect(await screen.findByText(/kit YAML is invalid/i)).toBeInTheDocument()
    expect(defCreate).not.toHaveBeenCalled()
  })

  it('seeds the network tier from the saved default for a new definition', async () => {
    prefsGet.mockResolvedValueOnce({ ok: true, data: 'balanced' })
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    await waitFor(() => expect(prefsGet).toHaveBeenCalledWith('defaultTier'))
    fireEvent.change(screen.getByLabelText(/workspace/i), { target: { value: '/home/u/alpha' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 1 -> 2 base image
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 2 -> 3 network
    await waitFor(() => expect(screen.getByRole('radio', { name: /balanced/i })).toBeChecked())
  })

  it('does not seed the network tier from the preference in edit mode', async () => {
    render(<CreateDefinition initial={editSpec} onDone={() => {}} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText(/workspace/i)).toBeInTheDocument())
    expect(prefsGet).not.toHaveBeenCalledWith('defaultTier')
  })

  it('shows an error and disables Next when memory is invalid', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: '/tmp/proj' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 1 -> 2
    fireEvent.change(screen.getByLabelText('Memory'), { target: { value: '8gb' } }) // invalid
    expect(screen.getByText(/binary size like 8g/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('shows a disk-size input in step 2 and an inline error on an invalid value', () => {
    render(<CreateDefinition onDone={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: '/tmp/proj' } })
    fireEvent.click(screen.getByRole('button', { name: /next/i })) // 1 -> 2
    const disk = screen.getByLabelText('Disk size')
    fireEvent.change(disk, { target: { value: '40gb' } })
    expect(screen.getByText(/binary size like/i)).toBeInTheDocument()
    fireEvent.change(disk, { target: { value: '40g' } })
    expect(screen.queryByText(/binary size like/i)).toBeNull()
  })
})
