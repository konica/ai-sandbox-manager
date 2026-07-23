import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OpenWithDialog } from '../../src/renderer/components/OpenWithDialog'

describe('OpenWithDialog', () => {
  it('chooses terminal or vscode', () => {
    const onChoose = vi.fn()
    render(<OpenWithDialog title="Open agent session" hasVSCode onChoose={onChoose} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^terminal$/i }))
    expect(onChoose).toHaveBeenCalledWith('terminal')
    fireEvent.click(screen.getByRole('button', { name: /^vs code$/i }))
    expect(onChoose).toHaveBeenCalledWith('vscode')
  })
  it('makes VS Code the primary (default) action when available', () => {
    render(<OpenWithDialog title="x" hasVSCode onChoose={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^vs code$/i })).toHaveClass('btn-primary')
    expect(screen.getByRole('button', { name: /^terminal$/i })).toHaveClass('btn-secondary')
  })
  it('disables VS Code and makes Terminal primary when unavailable', () => {
    render(<OpenWithDialog title="x" hasVSCode={false} onChoose={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^vs code$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^terminal$/i })).toHaveClass('btn-primary')
  })
})
