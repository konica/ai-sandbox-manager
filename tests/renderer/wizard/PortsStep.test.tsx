import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortsStep } from '../../../src/renderer/wizard/PortsStep'

type Props = Parameters<typeof PortsStep>[0]
function setup(over: Partial<Props> = {}) {
  const props: Props = { ports: [], hostServices: [], onAddPort: vi.fn(), onRemovePort: vi.fn(), onAddHostService: vi.fn(), onRemoveHostService: vi.fn(), ...over }
  render(<PortsStep {...props} />)
  return props
}

describe('PortsStep', () => {
  it('adds an explicit port with the selected protocol', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText('Port mapping'), { target: { value: '8080:3000' } })
    fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'tcp6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddPort).toHaveBeenCalledWith(8080, 3000, 'tcp6', '')
  })
  it('adds a bare port as ephemeral (null host port)', () => {
    const p = setup()
    fireEvent.change(screen.getByLabelText('Port mapping'), { target: { value: '3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddPort).toHaveBeenCalledWith(null, 3000, 'tcp', '')
  })
  it('renders a forwarded port row and removes it', () => {
    const p = setup({ ports: [{ hostPort: 8080, containerPort: 3000, protocol: 'tcp', label: 'web' }] })
    const removeBtn = screen.getByRole('button', { name: /remove port/i })
    expect(removeBtn.closest('div')?.textContent).toContain('8080') // the port row shows the mapping
    fireEvent.click(removeBtn)
    expect(p.onRemovePort).toHaveBeenCalledWith(0)
  })
  it('adds a host service and shows the allowlist hint', () => {
    const p = setup({ hostServices: [{ hostPort: 11434, label: 'Ollama' }] })
    expect(screen.getByText(/localhost:11434/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Host port'), { target: { value: '5432' } })
    fireEvent.click(screen.getByRole('button', { name: /add host service/i }))
    expect(p.onAddHostService).toHaveBeenCalledWith(5432, '')
  })
})
