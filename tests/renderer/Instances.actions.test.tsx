import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Instances } from '../../src/renderer/screens/Instances'
import type { InstanceView } from '../../src/shared/types'

const inst: InstanceView = {
  name: 'my-project', status: 'running', agent: 'Claude Code', workspace: '/p', ports: [],
  definitionId: 'd1', definitionName: 'My Project', tier: 'locked'
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
})
