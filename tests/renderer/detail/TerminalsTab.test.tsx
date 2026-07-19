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
  it('launches agent and shell in the native terminal', () => {
    const onAttach = vi.fn(); const onShell = vi.fn()
    render(<TerminalsTab instance={inst} spec={spec} onAttach={onAttach} onShell={onShell} />)
    fireEvent.click(screen.getByRole('button', { name: /agent/i })); expect(onAttach).toHaveBeenCalledWith('sbx-a')
    fireEvent.click(screen.getByRole('button', { name: /shell/i })); expect(onShell).toHaveBeenCalledWith('sbx-a')
  })
  it('shows the info sidebar from the spec (domains, credential, mounts)', () => {
    render(<TerminalsTab instance={inst} spec={spec} onAttach={vi.fn()} onShell={vi.fn()} />)
    expect(screen.getByText('github.com')).toBeInTheDocument()
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument()
    expect(screen.getByText('/shared')).toBeInTheDocument()
  })
  it('disables launch buttons when not running', () => {
    render(<TerminalsTab instance={{ ...inst, status: 'stopped' }} spec={spec} onAttach={vi.fn()} onShell={vi.fn()} />)
    expect(screen.getByRole('button', { name: /agent/i })).toBeDisabled()
  })
  it('degrades when there is no linked definition', () => {
    render(<TerminalsTab instance={inst} spec={null} onAttach={vi.fn()} onShell={vi.fn()} />)
    expect(screen.getByText(/no linked definition/i)).toBeInTheDocument()
  })
  it('allows and denies domains live when handlers are provided', () => {
    const onAllowDomain = vi.fn(); const onDenyDomain = vi.fn()
    render(<TerminalsTab instance={inst} spec={spec} onAttach={vi.fn()} onShell={vi.fn()} onAllowDomain={onAllowDomain} onDenyDomain={onDenyDomain} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny github.com' }))
    expect(onDenyDomain).toHaveBeenCalledWith('github.com')
    fireEvent.change(screen.getByLabelText('Add domain'), { target: { value: 'pypi.org' } })
    fireEvent.click(screen.getByRole('button', { name: /allow/i }))
    expect(onAllowDomain).toHaveBeenCalledWith('pypi.org')
  })
})
