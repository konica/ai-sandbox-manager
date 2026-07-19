import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InstanceDetail } from '../../src/renderer/screens/InstanceDetail'
import type { InstanceView } from '../../src/shared/types'

const inst: InstanceView = { name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'prj', tier: 'locked' }
const base = { onBack: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(), onAttach: vi.fn(), onShell: vi.fn() }

describe('InstanceDetail', () => {
  it('shows the header, tabs, and switches tabs', () => {
    render(<InstanceDetail instance={inst} {...base} />)
    expect(screen.getByRole('heading', { name: 'sbx-a' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Terminals' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Ports' }))
    expect(screen.getByRole('tab', { name: 'Ports' })).toHaveAttribute('aria-selected', 'true')
  })
  it('Back and Stop/Remove call their handlers', () => {
    const onBack = vi.fn(); const onStop = vi.fn(); const onRemove = vi.fn()
    render(<InstanceDetail instance={inst} {...base} onBack={onBack} onStop={onStop} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i })); expect(onBack).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /stop/i })); expect(onStop).toHaveBeenCalledWith('sbx-a')
    fireEvent.click(screen.getByRole('button', { name: /remove/i })); expect(onRemove).toHaveBeenCalledWith('sbx-a')
  })
  it('disables Stop when not running', () => {
    render(<InstanceDetail instance={{ ...inst, status: 'stopped' }} {...base} />)
    expect(screen.getByRole('button', { name: /stop/i })).toBeDisabled()
  })
})
