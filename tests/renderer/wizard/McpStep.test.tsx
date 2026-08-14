import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { McpStep } from '../../../src/renderer/wizard/McpStep'

type Props = Parameters<typeof McpStep>[0]
function setup(over: Partial<Props> = {}) {
  const props: Props = {
    mode: 'off',
    selected: [],
    agentLabel: 'Claude Code',
    agentMcpSupported: true,
    listState: 'ready',
    servers: [],
    auth: {},
    onModeChange: vi.fn(),
    onToggleServer: vi.fn(),
    ...over
  }
  render(<McpStep {...props} />)
  return props
}

describe('McpStep', () => {
  it('changes mode via the radio cards', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('radio', { name: /dynamic/i }))
    expect(p.onModeChange).toHaveBeenCalledWith('dynamic')
  })

  it('shows the Static registry count on its card', () => {
    setup({ servers: [{ name: 'a', transport: 'remote', endpoint: 'https://a', scopes: [] }, { name: 'b', transport: 'remote', endpoint: 'https://b', scopes: [] }] })
    expect(screen.getByText(/Static \(2\)/)).toBeInTheDocument()
  })

  it('replaces the selection area with a guidance message when the registry is empty (static mode)', () => {
    setup({ mode: 'static', servers: [] })
    expect(screen.getByText(/add one from the mcp servers screen/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('lists registered servers as checkboxes with type + auth badges, and toggles selection', () => {
    const p = setup({
      mode: 'static',
      servers: [{ name: 'github', transport: 'remote', endpoint: 'https://x', scopes: [] }],
      auth: { github: 'authorized' }
    })
    expect(screen.getByText('github')).toBeInTheDocument()
    expect(screen.getByText('Remote')).toBeInTheDocument()
    expect(screen.getByText('Authorized')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(p.onToggleServer).toHaveBeenCalledWith('github')
  })

  it('re-surfaces the host warning inline when a local-stdio server is selected', () => {
    const servers: Props['servers'] = [{ name: 'local-tool', transport: 'command', endpoint: '/usr/bin/tool', scopes: [] }]
    setup({ mode: 'static', servers, selected: [] })
    expect(screen.queryByText(/no sandbox isolation/i)).toBeNull()
    // re-render with the local-stdio server selected
    setup({ mode: 'static', servers, selected: ['local-tool'] })
    expect(screen.getByText(/no sandbox isolation/i)).toBeInTheDocument()
  })

  it('keeps needs-auth servers selectable and shows a soft nudge', () => {
    const servers: Props['servers'] = [{ name: 'needs-auth-server', transport: 'remote', endpoint: 'https://x', scopes: [] }]
    setup({ mode: 'static', servers, auth: { 'needs-auth-server': 'unauthorized' } })
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeDisabled()
    expect(screen.getByText(/can still be selected/i)).toBeInTheDocument()
  })

  it('shows a quiet note (controls stay enabled) when the agent does not support MCP', () => {
    setup({ agentMcpSupported: false, agentLabel: 'GitHub Copilot' })
    expect(screen.getByText(/GitHub Copilot.*doesn.t support MCP yet/i)).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeDisabled()
  })

  it('shows a loading state while the registry is being fetched', () => {
    setup({ mode: 'static', listState: 'loading' })
    expect(screen.getByText(/loading mcp servers/i)).toBeInTheDocument()
  })

  it('shows an error state when the registry fails to load', () => {
    setup({ mode: 'static', listState: 'error', errorMessage: 'boom' })
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })
})
