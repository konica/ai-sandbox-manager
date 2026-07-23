import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TerminalsTab } from '../../../src/renderer/screens/detail/TerminalsTab'
import type { InstanceView, DefinitionSpec } from '../../../src/shared/types'

const inst: InstanceView = { name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'prj', tier: 'locked' }
const spec: DefinitionSpec = {
  definition: { id: 'd1', name: 'prj', description: '', baseImage: 'i:t', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }, { hostPath: '/shared', mode: 'clone', isPrimary: false }],
  domains: ['github.com'], ports: [], hostServices: [],
  credentials: [{ kind: 'service', serviceId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', store: 'sbx' }]
}

describe('TerminalsTab', () => {
  it('opens the agent in Terminal or VS Code and a shell', () => {
    const onAttach = vi.fn(); const onShell = vi.fn()
    render(<TerminalsTab instance={inst} spec={spec} hasVSCode onAttach={onAttach} onShell={onShell} />)
    fireEvent.click(screen.getByRole('button', { name: /agent in terminal/i })); expect(onAttach).toHaveBeenCalledWith('sbx-a', 'terminal', true)
    fireEvent.click(screen.getByRole('button', { name: /agent in vs code/i })); expect(onAttach).toHaveBeenCalledWith('sbx-a', 'vscode', true)
    fireEvent.click(screen.getByRole('button', { name: /shell/i })); expect(onShell).toHaveBeenCalledWith('sbx-a')
  })
  it('disables the VS Code agent button when the code CLI is unavailable', () => {
    render(<TerminalsTab instance={inst} spec={spec} hasVSCode={false} onAttach={vi.fn()} onShell={vi.fn()} />)
    expect(screen.getByRole('button', { name: /agent in vs code/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /agent in terminal/i })).not.toBeDisabled()
  })
  it('shows the info sidebar from the spec (domains, credential, mounts)', () => {
    render(<TerminalsTab instance={inst} spec={spec} hasVSCode onAttach={vi.fn()} onShell={vi.fn()} />)
    expect(screen.getByText('github.com')).toBeInTheDocument()
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument()
    expect(screen.getByText('/shared')).toBeInTheDocument()
  })
  it('keeps the Agent buttons enabled when stopped (they re-run the sandbox) but disables Shell', () => {
    const onAttach = vi.fn()
    render(<TerminalsTab instance={{ ...inst, status: 'stopped' }} spec={spec} hasVSCode onAttach={onAttach} onShell={vi.fn()} />)
    const agentTerminal = screen.getByRole('button', { name: /start agent in terminal/i })
    expect(agentTerminal).not.toBeDisabled()
    fireEvent.click(agentTerminal)
    expect(onAttach).toHaveBeenCalledWith('sbx-a', 'terminal', true)
    expect(screen.getByRole('button', { name: /shell/i })).toBeDisabled()
  })
  it('copies the manual agent / shell commands to the clipboard', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<TerminalsTab instance={inst} spec={spec} hasVSCode agentCommand="sbx run --name sbx-a -- --continue" shellCommand="sbx exec -it sbx-a bash" onAttach={vi.fn()} onShell={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /copy agent command/i }))
    expect(writeText).toHaveBeenCalledWith('sbx run --name sbx-a -- --continue')
    fireEvent.click(screen.getByRole('button', { name: /copy shell command/i }))
    expect(writeText).toHaveBeenCalledWith('sbx exec -it sbx-a bash')
  })
  it('degrades when there is no linked definition', () => {
    render(<TerminalsTab instance={inst} spec={null} hasVSCode onAttach={vi.fn()} onShell={vi.fn()} />)
    expect(screen.getByText(/no linked definition/i)).toBeInTheDocument()
  })
  it('allows and denies domains live when handlers are provided', () => {
    const onAllowDomain = vi.fn(); const onDenyDomain = vi.fn()
    render(<TerminalsTab instance={inst} spec={spec} hasVSCode onAttach={vi.fn()} onShell={vi.fn()} onAllowDomain={onAllowDomain} onDenyDomain={onDenyDomain} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny github.com' }))
    expect(onDenyDomain).toHaveBeenCalledWith('github.com')
    fireEvent.change(screen.getByLabelText('Add domain'), { target: { value: 'pypi.org' } })
    fireEvent.click(screen.getByRole('button', { name: /^allow$/i }))
    expect(onAllowDomain).toHaveBeenCalledWith('pypi.org')
  })
})
