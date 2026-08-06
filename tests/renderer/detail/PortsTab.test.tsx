import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortsTab } from '../../../src/renderer/screens/detail/PortsTab'
import type { InstanceView, LivePort, HostServiceIntent } from '../../../src/shared/types'

const inst: InstanceView = { name: 'box', status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'p', tier: 'locked', tags: [], createdAt: null }
const ports: LivePort[] = [{ hostPort: 8080, containerPort: 3000, protocol: 'tcp' }]
const hs: HostServiceIntent[] = [{ hostPort: 11434, label: 'Ollama' }]

type Props = Parameters<typeof PortsTab>[0]
function props(over: Partial<Props> = {}): Props {
  return { instance: inst, ports: [], hostServices: [], linked: true, onPublish: vi.fn(), onUnpublish: vi.fn(), onAddHostService: vi.fn(), onRemoveHostService: vi.fn(), ...over }
}

describe('PortsTab', () => {
  it('lists a forward and removes it', () => {
    const p = props({ ports }); render(<PortsTab {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /remove forward/i }))
    expect(p.onUnpublish).toHaveBeenCalledWith(ports[0])
  })
  it('adds a forward from the input + protocol', () => {
    const p = props(); render(<PortsTab {...p} />)
    fireEvent.change(screen.getByLabelText('Port mapping'), { target: { value: '9229:9229' } })
    fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'tcp6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(p.onPublish).toHaveBeenCalledWith({ hostPort: 9229, containerPort: 9229, protocol: 'tcp6' })
  })
  it('adds and removes a host service', () => {
    const p = props({ hostServices: hs }); render(<PortsTab {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /remove host service/i }))
    expect(p.onRemoveHostService).toHaveBeenCalledWith(11434)
    fireEvent.change(screen.getByLabelText('Host port'), { target: { value: '5432' } })
    fireEvent.click(screen.getByRole('button', { name: /add host service/i }))
    expect(p.onAddHostService).toHaveBeenCalledWith(5432, '')
  })
  it('warns when the instance is not linked to a definition', () => {
    render(<PortsTab {...props({ linked: false })} />)
    expect(screen.getByText(/won't persist/i)).toBeInTheDocument()
  })
})
