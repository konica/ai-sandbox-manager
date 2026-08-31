import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CredentialsStep } from '../../../src/renderer/wizard/CredentialsStep'

type Props = Parameters<typeof CredentialsStep>[0]
function setup(over: Partial<Props> = {}) {
  const props: Props = { credentials: [], onAddService: vi.fn(), onAddCustom: vi.fn(), onAddRegistry: vi.fn(), onRemove: vi.fn(), envHits: [], onImport: vi.fn(), ssh: { forwardAgent: true, commitSigning: false }, onSshChange: vi.fn(), sshDetected: true, ...over }
  render(<CredentialsStep {...props} />)
  return props
}

describe('CredentialsStep', () => {
  it('adds a service credential from the Service tab', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk-ant-xyz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddService).toHaveBeenCalledWith('anthropic', 'ANTHROPIC_API_KEY', 'sk-ant-xyz')
  })
  it('switches to the Custom tab and adds a custom credential (host + env var + value, no header fields)', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Custom Secret' }))
    expect(screen.queryByLabelText('Header Name')).toBeNull() // v7: header fields removed
    expect(screen.queryByLabelText('Value Format')).toBeNull()
    fireEvent.change(screen.getByLabelText('Host / Domain'), { target: { value: 'api.acme.com' } })
    fireEvent.change(screen.getByLabelText('Environment Variable'), { target: { value: 'ACME_KEY' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'v' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddCustom).toHaveBeenCalledWith(expect.objectContaining({ kind: 'custom', envVar: 'ACME_KEY', domains: ['api.acme.com'] }))
  })
  // sbx rejects a target with a scheme or port outright, and the failure used to surface only in
  // the app log — long after launch — so catch it where the value is entered.
  it('normalises a pasted API base URL to the bare host sbx accepts', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Custom Secret' }))
    fireEvent.change(screen.getByLabelText('Host / Domain'), { target: { value: 'https://api.mem0.ai/v1/' } })
    fireEvent.change(screen.getByLabelText('Environment Variable'), { target: { value: 'MEM0_API_KEY' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'v' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddCustom).toHaveBeenCalledWith(expect.objectContaining({ envVar: 'MEM0_API_KEY', domains: ['api.mem0.ai'], label: 'api.mem0.ai' }))
  })
  it('refuses a host it cannot normalise and says so instead of storing an unusable target', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Custom Secret' }))
    fireEvent.change(screen.getByLabelText('Host / Domain'), { target: { value: 'not a host' } })
    fireEvent.change(screen.getByLabelText('Environment Variable'), { target: { value: 'K' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'v' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddCustom).not.toHaveBeenCalled()
    expect(screen.getByText(/bare host/i)).toBeInTheDocument()
  })
  it('renders added credentials and removes one', () => {
    const p = setup({ credentials: [{ kind: 'service', serviceId: 'openai', envVar: 'OPENAI_API_KEY', value: '' }] })
    const removeBtn = screen.getByRole('button', { name: /remove/i })
    expect(removeBtn.closest('div')?.textContent).toContain('OpenAI') // the credential row shows the service label
    fireEvent.click(removeBtn)
    expect(p.onRemove).toHaveBeenCalledWith(0)
  })
  it('imports a detected env var via the import panel', () => {
    const p = setup({ envHits: [{ serviceId: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', masked: 'sk-ant…' }] })
    fireEvent.click(screen.getByRole('button', { name: /import from environment/i })) // expand banner
    fireEvent.click(screen.getByRole('checkbox', { name: /anthropic/i }))
    fireEvent.click(screen.getByRole('button', { name: /import selected/i }))
    expect(p.onImport).toHaveBeenCalledWith('anthropic', expect.any(String))
  })

  it('shows each tab only its own added list (service list not shown on the Custom tab)', () => {
    setup({ credentials: [
      { kind: 'service', serviceId: 'openai', envVar: 'OPENAI_API_KEY', value: '' },
      { kind: 'custom', id: 'acme', label: 'Acme', envVar: 'ACME_KEY', domains: ['api.acme.com'], value: '' }
    ] })
    // default (Service) tab: service list shown, custom list hidden
    expect(screen.getByText('Added service credentials')).toBeInTheDocument()
    expect(screen.queryByText('Added custom secrets')).toBeNull()
    // switch to Custom tab: custom list shown, service list hidden
    fireEvent.click(screen.getByRole('tab', { name: 'Custom Secret' }))
    expect(screen.getByText('Added custom secrets')).toBeInTheDocument()
    expect(screen.queryByText('Added service credentials')).toBeNull()
  })

  it('adds a registry credential from the Registry tab (host + username + token + scope)', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Registry Credential' }))
    fireEvent.change(screen.getByLabelText('Registry Host'), { target: { value: 'ghcr.io' } })
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'me' } })
    fireEvent.change(screen.getByLabelText(/token/i), { target: { value: 'ghp_secret' } })
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'global' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddRegistry).toHaveBeenCalledWith(expect.objectContaining({ kind: 'registry', host: 'ghcr.io', username: 'me', scope: 'global', value: 'ghp_secret' }))
  })
  it('shows registry list only on the Registry tab and masks the token', () => {
    setup({ credentials: [{ kind: 'registry', id: 'ghcr-io', host: 'ghcr.io', username: 'me', scope: 'global', value: '' }] })
    // default (Service) tab: registry list hidden
    expect(screen.queryByText('Added registry credentials')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Registry Credential' }))
    expect(screen.getByText('Added registry credentials')).toBeInTheDocument()
    expect(screen.getByText('ghcr.io')).toBeInTheDocument()
  })

  it('SSH tab shows detection status and toggles forward/signing', () => {
    const p = setup({ sshDetected: true })
    fireEvent.click(screen.getByRole('tab', { name: 'SSH Agent' }))
    expect(screen.getByText(/ssh agent detected/i)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Automatic Commit Signing'))
    expect(p.onSshChange).toHaveBeenCalledWith({ forwardAgent: true, commitSigning: true })
  })
  it('offers a collapsible setup guide with the ssh-add command', () => {
    setup({ sshDetected: false, hostPlatform: 'darwin' })
    fireEvent.click(screen.getByRole('tab', { name: 'SSH Agent' }))
    // command hidden until the guide is expanded
    expect(screen.queryByText(/ssh-add --apple-use-keychain/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /how do i enable this/i }))
    expect(screen.getByText(/ssh-add --apple-use-keychain ~\/\.ssh\/id_ed25519/)).toBeInTheDocument()
  })

  // The guide used to be macOS-only. It now opens on the detected host OS and stays
  // switchable, so each platform gets steps that actually work there.
  function openGuide(over: Partial<Props> = {}) {
    setup({ sshDetected: false, ...over })
    fireEvent.click(screen.getByRole('tab', { name: 'SSH Agent' }))
    fireEvent.click(screen.getByRole('button', { name: /how do i enable this/i }))
  }

  it('opens the guide on the detected host OS (Linux)', () => {
    openGuide({ hostPlatform: 'linux' })
    expect(screen.getByRole('tab', { name: 'Linux' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/systemctl --user enable --now ssh-agent/)).toBeInTheDocument()
    // macOS-only options must not leak into the Linux commands. `UseKeychain` is matched as
    // the ssh_config directive (`UseKeychain yes`) because step 3's prose names it too, to
    // explain why it is absent.
    expect(screen.queryByText(/UseKeychain yes/)).toBeNull()
    expect(screen.queryByText(/--apple-use-keychain/)).toBeNull()
  })

  it('opens the guide on the detected host OS (Windows) and points at WSL', () => {
    openGuide({ hostPlatform: 'win32' })
    expect(screen.getByRole('tab', { name: 'Windows' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/ssh-agent -a "\$SSH_AUTH_SOCK"/)).toBeInTheDocument()
    expect(screen.getByText(/openssh-ssh-agent/)).toBeInTheDocument()
    expect(screen.queryByText(/--apple-use-keychain/)).toBeNull()
  })

  it('defaults to macOS when the host platform is not yet known', () => {
    openGuide({ hostPlatform: '' })
    expect(screen.getByRole('tab', { name: 'macOS' })).toHaveAttribute('aria-selected', 'true')
  })

  it('lets the user read another platform’s steps regardless of their own host', () => {
    openGuide({ hostPlatform: 'darwin' })
    expect(screen.getByText(/--apple-use-keychain/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Windows' }))
    expect(screen.getByText(/openssh-ssh-agent/)).toBeInTheDocument()
    expect(screen.queryByText(/--apple-use-keychain/)).toBeNull()
  })
  it('disables commit signing when forward is off', () => {
    setup({ ssh: { forwardAgent: false, commitSigning: false } })
    fireEvent.click(screen.getByRole('tab', { name: 'SSH Agent' }))
    expect(screen.getByLabelText('Automatic Commit Signing')).toBeDisabled()
  })
  it('turning forward off clears signing', () => {
    const p = setup({ ssh: { forwardAgent: true, commitSigning: true } })
    fireEvent.click(screen.getByRole('tab', { name: 'SSH Agent' }))
    fireEvent.click(screen.getByLabelText('Forward SSH Agent'))
    expect(p.onSshChange).toHaveBeenCalledWith({ forwardAgent: false, commitSigning: false })
  })

  it('shows an empty-state when no env vars are detected', () => {
    setup({ envHits: [] })
    fireEvent.click(screen.getByRole('button', { name: /import from environment/i }))
    expect(screen.getByText(/no api keys detected/i)).toBeInTheDocument()
  })
})
