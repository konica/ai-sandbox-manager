import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { McpServers } from '../../src/renderer/screens/McpServers'
import type { Definition, InstanceView } from '@shared/types'

const mcpList = vi.fn()
const mcpAuthStatus = vi.fn()
const mcpInspect = vi.fn()
const mcpAdd = vi.fn()
const mcpStartAuth = vi.fn()
const defGetSpec = vi.fn()

vi.mock('../../src/renderer/ipc/client', () => ({
  api: {
    mcpList: () => mcpList(),
    mcpAuthStatus: (name: string) => mcpAuthStatus(name),
    mcpInspect: (name: string) => mcpInspect(name),
    mcpAdd: (input: unknown) => mcpAdd(input),
    mcpStartAuth: (name: string) => mcpStartAuth(name),
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
  mcpList.mockReset(); mcpAuthStatus.mockReset(); mcpInspect.mockReset(); mcpAdd.mockReset(); mcpStartAuth.mockReset(); defGetSpec.mockReset()
  mcpAuthStatus.mockResolvedValue({ ok: true, data: 'unknown' })
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

  it('adds a valid remote server and refreshes the list without a restart', async () => {
    mcpList.mockResolvedValueOnce({ ok: true, data: [] })
    mcpAdd.mockResolvedValue({ ok: true, data: null })
    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText(/no mcp servers registered/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'notion' } })
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://mcp.notion.com/mcp' } })

    mcpList.mockResolvedValueOnce({ ok: true, data: [{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }] })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(mcpAdd).toHaveBeenCalledWith({ transport: 'remote', name: 'notion', url: 'https://mcp.notion.com/mcp', scopes: [] }))
    await waitFor(() => expect(screen.getByText('notion')).toBeInTheDocument())
    // panel collapses on success
    expect(screen.queryByLabelText('Server URL')).toBeNull()
  })

  it('blocks a non-https remote URL with a role=alert message and never calls the CLI', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [] })
    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText(/no mcp servers registered/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'notion' } })
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'http://insecure.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid https/i)
    expect(mcpAdd).not.toHaveBeenCalled()
  })

  it('blocks a duplicate server name with a role=alert message', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }] })
    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText('notion')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'Notion' } })
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://mcp.notion.com/mcp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/i)
    expect(mcpAdd).not.toHaveBeenCalled()
  })

  it('requires an empty command to be rejected on the Command tab, never calling the CLI', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [] })
    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText(/no mcp servers registered/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    fireEvent.click(screen.getByRole('tab', { name: 'Command' }))
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'local-tool' } })
    fireEvent.click(screen.getByLabelText(/understand this server runs on the host/i))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((a) => /command is required/i.test(a.textContent ?? ''))).toBe(true)
    expect(mcpAdd).not.toHaveBeenCalled()
  })

  it('shows the host-isolation warning on the Command tab and blocks submit until acknowledged', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [] })
    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText(/no mcp servers registered/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    fireEvent.click(screen.getByRole('tab', { name: 'Command' }))
    expect(screen.getByText('Host access — no sandbox isolation')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'local-tool' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/acknowledge host access/i)
    expect(mcpAdd).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText(/understand this server runs on the host/i))
    mcpAdd.mockResolvedValue({ ok: true, data: null })
    mcpList.mockResolvedValueOnce({ ok: true, data: [{ name: 'local-tool', transport: 'command', endpoint: 'npx', scopes: [] }] })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(mcpAdd).toHaveBeenCalledWith({ transport: 'command', name: 'local-tool', command: 'npx', args: [], scopes: [] }))
  })

  it('surfaces a CLI-level add failure and leaves the form populated', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [] })
    mcpAdd.mockResolvedValue({ ok: false, error: { kind: 'generic', message: 'already registered on host' } })
    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText(/no mcp servers registered/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add server/i }))
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'notion' } })
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://mcp.notion.com/mcp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered on host/i)
    // form stays populated after a CLI-level failure
    expect(screen.getByLabelText('Server name')).toHaveValue('notion')
    expect(screen.getByLabelText('Server URL')).toHaveValue('https://mcp.notion.com/mcp')
  })

  it('shows an inline Authorize action only on needs-auth rows', async () => {
    mcpList.mockResolvedValue({
      ok: true,
      data: [
        { name: 'needs-it', transport: 'remote', endpoint: 'https://a.example.com', scopes: [] },
        { name: 'already-authed', transport: 'remote', endpoint: 'https://b.example.com', scopes: [] },
        { name: 'no-auth-required', transport: 'remote', endpoint: 'https://c.example.com', scopes: [] }
      ]
    })
    mcpAuthStatus.mockImplementation((name: string) =>
      Promise.resolve({ ok: true, data: name === 'needs-it' ? 'unauthorized' : name === 'already-authed' ? 'authorized' : 'not-required' })
    )

    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText('needs-it')).toBeInTheDocument())

    expect(screen.getAllByRole('button', { name: /^authorize$/i })).toHaveLength(1)
  })

  it('clicking Authorize starts the terminal OAuth flow and shows a hint', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }] })
    mcpAuthStatus.mockResolvedValue({ ok: true, data: 'unauthorized' })
    mcpStartAuth.mockResolvedValue({ ok: true, data: null })

    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText('notion')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /^authorize$/i }))

    expect(mcpStartAuth).toHaveBeenCalledWith('notion')
    await waitFor(() => expect(screen.getByText(/complete sign-in in the terminal/i)).toBeInTheDocument())
    // status is untouched until the re-poll — still needs-auth
    expect(screen.getByText('Needs auth')).toBeInTheDocument()
  })

  it('leaves status unchanged and shows a clear notice when starting auth fails', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }] })
    mcpAuthStatus.mockResolvedValue({ ok: true, data: 'unauthorized' })
    mcpStartAuth.mockResolvedValue({ ok: false, error: { kind: 'generic', message: 'could not open terminal' } })

    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText('notion')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /^authorize$/i }))

    await waitFor(() => expect(screen.getByText(/could not open terminal/i)).toBeInTheDocument())
    expect(screen.getByText('Needs auth')).toBeInTheDocument()
  })

  it('re-polls auth status on window focus and flips the badge without re-fetching the list', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }] })
    mcpAuthStatus.mockResolvedValue({ ok: true, data: 'unauthorized' })

    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText('Needs auth')).toBeInTheDocument())
    expect(mcpList).toHaveBeenCalledTimes(1)

    mcpAuthStatus.mockResolvedValue({ ok: true, data: 'authorized' })
    fireEvent(window, new Event('focus'))

    await waitFor(() => expect(screen.getByText('Authorized')).toBeInTheDocument())
    expect(mcpList).toHaveBeenCalledTimes(1)
  })

  it('shows Authorize in the inspect view for a needs-auth server and re-polls on focus', async () => {
    mcpList.mockResolvedValue({ ok: true, data: [{ name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [] }] })
    mcpAuthStatus.mockResolvedValue({ ok: true, data: 'unauthorized' })
    mcpInspect.mockResolvedValue({
      ok: true,
      data: { name: 'notion', transport: 'remote', endpoint: 'https://mcp.notion.com/mcp', scopes: [], tools: ['search'], raw: '{}' }
    })
    defGetSpec.mockResolvedValue({ ok: true, data: null })

    render(<McpServers defs={[]} instances={[]} />)
    await waitFor(() => expect(screen.getByText('notion')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /inspect/i }))

    await waitFor(() => expect(screen.getByText('Needs auth')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^authorize$/i })).toBeInTheDocument()

    mcpAuthStatus.mockResolvedValue({ ok: true, data: 'authorized' })
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(screen.getByText('Authorized')).toBeInTheDocument())
  })
})
