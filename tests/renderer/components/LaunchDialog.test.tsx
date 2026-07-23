import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LaunchDialog } from '../../../src/renderer/components/LaunchDialog'

const def = { id: 'd1', name: 'My Project', description: '', baseImage: '', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' } as never

describe('LaunchDialog yolo toggle', () => {
  it('defaults Yolo ON and passes yolo=true on launch', () => {
    const onLaunch = vi.fn()
    render(<LaunchDialog definition={def} hasVSCode={false} cloneMode={false} onLaunch={onLaunch} onCancel={vi.fn()} />)
    const box = screen.getByRole('checkbox', { name: /yolo/i })
    expect(box).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /launch/i }))
    expect(onLaunch).toHaveBeenCalledWith('', 'terminal', true)
  })
  it('passes yolo=false when unchecked', () => {
    const onLaunch = vi.fn()
    render(<LaunchDialog definition={def} hasVSCode={false} cloneMode={false} onLaunch={onLaunch} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /yolo/i }))
    fireEvent.click(screen.getByRole('button', { name: /launch/i }))
    expect(onLaunch).toHaveBeenCalledWith('', 'terminal', false)
  })
})
