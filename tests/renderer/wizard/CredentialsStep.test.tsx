import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CredentialsStep } from '../../../src/renderer/wizard/CredentialsStep'

type Props = Parameters<typeof CredentialsStep>[0]
function setup(over: Partial<Props> = {}) {
  const props: Props = { credentials: [], onAddService: vi.fn(), onAddCustom: vi.fn(), onRemove: vi.fn(), envHits: [], onImport: vi.fn(), ...over }
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
  it('switches to the Custom tab and adds a custom credential with a header', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Custom Secret' }))
    fireEvent.change(screen.getByLabelText('Host / Domain'), { target: { value: 'api.acme.com' } })
    fireEvent.change(screen.getByLabelText('Environment Variable'), { target: { value: 'ACME_KEY' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'v' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddCustom).toHaveBeenCalledWith(expect.objectContaining({ kind: 'custom', envVar: 'ACME_KEY', domains: ['api.acme.com'] }))
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

  it('shows an empty-state when no env vars are detected', () => {
    setup({ envHits: [] })
    fireEvent.click(screen.getByRole('button', { name: /import from environment/i }))
    expect(screen.getByText(/no api keys detected/i)).toBeInTheDocument()
  })
})
