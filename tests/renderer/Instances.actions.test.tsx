import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Instances } from '../../src/renderer/screens/Instances'
import type { InstanceView } from '../../src/shared/types'

const inst: InstanceView = {
  name: 'my-project', status: 'running', agent: 'Claude Code', workspace: '/p', ports: [],
  definitionId: 'd1', definitionName: 'My Project', tier: 'locked', tags: []
}

describe('Instances actions', () => {
  it('invokes attach/shell/stop/remove callbacks with the instance name', () => {
    const onAttach = vi.fn(); const onShell = vi.fn(); const onStop = vi.fn(); const onRemove = vi.fn()
    render(<Instances instances={[inst]} onAttach={onAttach} onShell={onShell} onStop={onStop} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shell' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onAttach).toHaveBeenCalledWith('my-project')
    expect(onShell).toHaveBeenCalledWith('my-project')
    expect(onStop).toHaveBeenCalledWith('my-project')
    expect(onRemove).toHaveBeenCalledWith('my-project')
  })

  it('exposes the full workspace path as a tooltip (title)', () => {
    const longPath = '/Users/ttdinh/Documents/Working/Projects/AISandbox/testaisandbox'
    render(<Instances instances={[{ ...inst, workspace: longPath }]} />)
    expect(screen.getByTitle(longPath)).toBeInTheDocument()
  })

  it('disables Stop unless the instance is running', () => {
    const { rerender } = render(<Instances instances={[{ ...inst, status: 'stopped' }]} onStop={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
    rerender(<Instances instances={[{ ...inst, status: 'running' }]} onStop={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })

  it('renders ports on a single line with the full list in a tooltip', () => {
    const ports = ['5173/tcp', '8200/tcp', '9000/tcp', '9001/tcp', '9091/tcp', '19530/tcp']
    render(<Instances instances={[{ ...inst, ports }]} />)
    const cell = screen.getByTitle(ports.join(', '))
    expect(cell).toBeInTheDocument()
    expect(cell).toHaveStyle({ whiteSpace: 'nowrap' })
  })
})
