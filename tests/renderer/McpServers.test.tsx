import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { McpServers } from '../../src/renderer/screens/McpServers'
import type { Definition, InstanceView } from '@shared/types'

const mcpList = vi.fn()
const mcpAuthStatus = vi.fn()
const mcpInspect = vi.fn()
const defGetSpec = vi.fn()

vi.mock('../../src/renderer/ipc/client', () => ({
  api: {
    mcpList: () => mcpList(),
    mcpAuthStatus: (name: string) => mcpAuthStatus(name),
    mcpInspect: (name: string) => mcpInspect(name),
    defGetSpec: (id: string) => defGetSpec(id)
  }
}))

const defs: Definition[] = [
  { id: 'd1', name: 'Alpha', description: '', agent: 'claude', baseImage: 'i:t', tier: 'locked', createdAt: '2026-01-01T00:00:00Z' }
]
const instances: InstanceView[] = [
  { name: 'alpha-1', status: 'running', agent: 'Claude Code', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'Alpha', tier: 'locked', tags: [], createdAt: null }
]

beforeEach(() => {
  mcpList.mockReset(); mcpAuthStatus.mockReset(); mcpInspect.mockReset(); defGetSpec.mockReset()
})

describe('McpServers screen', () => {
  it('shows a loading state, then the populated list with name/type/endpoint/auth', async () => {
    mcpList.mockResolvedValue({
      ok: true,
      data: [
        { name: 'github', transport: 'remote', endpoint: 'https://mcp.example.com/sse?api_key=sk-12345', scopes: [] },
        { name: 'local-fs', transport: 'command', endpoint: 'npx server --api-key sk-999', scopes: [] }
      ]
    })
    mcpAuthStatus.mockImplementation((name: string) => Promise.resolve({ ok: true, data: name === 'github' ? 'authorized' : 'not-required' }))

    render(<McpServers defs={defs} instances={instances} />)
    expect(screen.getByText(/loading mcp servers/i)).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('github')).toBeInTheDocument())
    expect(screen.getByText('local-fs')).toBeInTheDocument()
    expect(screen.getByText('Remote')).toBeInTheDocument()
    expect(screen.getByText('Local (stdio)')).toBeInTheDocument()
    expect(screen.getByText('Authorized')).toBeInTheDocument()
    expect(screen.getByText('N/A')).toBeInTheDocument()
    // secret-bearing endpoint values are redacted in the list too
    expect(screen.queryByText(/sk-12345/)).toBeNull()
    expect(screen.queryByText(/sk-999/)).toBeNull()
  })

  it('shows a distinct empty state with an add hint when there are no servers', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [] })
    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText(/no mcp servers registered/i)).toBeInTheDocument())
    expect(screen.getByText(/sbx mcp add/)).toBeInTheDocument()
  })

  it('shows a distinct error state with Retry, which re-fetches on click', async () => {
    mcpList.mockResolvedValueOnce({ ok: false, error: { kind: 'generic', message: 'boom' } })
    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText(/could not load mcp servers: boom/i)).toBeInTheDocument())

    mcpList.mockResolvedValueOnce({ ok: true, data: [] })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByText(/no mcp servers registered/i)).toBeInTheDocument())
  })

  it('Refresh re-fetches the list', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [] })
    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText(/no mcp servers registered/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => expect(mcpList).toHaveBeenCalledTimes(2))
  })

  it('opens the inspect view with type, redacted connection details, auth, connectivity, and used-by counts', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [{ name: 'github', transport: 'remote', endpoint: 'https://mcp.example.com/sse', scopes: [] }] })
    mcpAuthStatus.mockResolvedValue({ ok: true, data: 'authorized' })
    mcpInspect.mockResolvedValue({
      ok: true,
      data: { name: 'github', transport: 'remote', endpoint: 'https://mcp.example.com/sse?token=sk-1', scopes: [], tools: ['search'], raw: '{}' }
    })
    defGetSpec.mockResolvedValue({
      ok: true,
      data: { definition: defs[0], mounts: [], domains: [], ports: [], hostServices: [], credentials: [], mcp: { mode: 'static', servers: ['github'] } }
    })

    render(<McpServers defs={defs} instances={instances} />)
    await waitFor(() => expect(screen.getByText('github')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /inspect/i }))

    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'github' })).toBeInTheDocument()
    expect(screen.queryByText(/sk-1/)).toBeNull()
    expect(screen.getByText('1 definition(s) · 1 instance(s)')).toBeInTheDocument()
  })

  it('shows a distinct error state in the inspect view when inspect fails', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [{ name: 'github', transport: 'remote', endpoint: 'https://mcp.example.com/sse', scopes: [] }] })
    mcpAuthStatus.mockResolvedValue({ ok: true, data: 'authorized' })
    mcpInspect.mockResolvedValue({ ok: false, error: { kind: 'generic', message: 'unreachable' } })
    defGetSpec.mockResolvedValue({ ok: true, data: null })

    render(<McpServers defs={defs} instances={instances} />)
    await waitFor(() => expect(screen.getByText('github')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /inspect/i }))
    await waitFor(() => expect(screen.getByText(/could not load mcp servers: unreachable/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByText('github')).toBeInTheDocument())
  })
})
