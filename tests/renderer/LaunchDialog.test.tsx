import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LaunchDialog } from '../../src/renderer/components/LaunchDialog'
import type { Definition } from '../../src/shared/types'

const def: Definition = { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' }

function setup(over: { hasVSCode?: boolean; cloneMode?: boolean } = {}) {
  const onLaunch = vi.fn(); const onCancel = vi.fn()
  render(<LaunchDialog definition={def} hasVSCode={over.hasVSCode ?? true} cloneMode={over.cloneMode ?? false} onLaunch={onLaunch} onCancel={onCancel} />)
  return { onLaunch, onCancel }
}

describe('LaunchDialog', () => {
  it('has an empty, optional session name with a placeholder', () => {
    setup()
    const input = screen.getByLabelText('Session name')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder')
  })

  it('launches with an empty session name and the VS Code opener by default when available', () => {
    const { onLaunch } = setup()
    expect(screen.getByLabelText('VS Code')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    expect(onLaunch).toHaveBeenCalledWith('', 'vscode')
  })

  it('passes the typed session name (trimmed) and chosen opener', () => {
    const { onLaunch } = setup()
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: '  Refactor auth  ' } })
    fireEvent.click(screen.getByLabelText('Terminal'))
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    expect(onLaunch).toHaveBeenCalledWith('Refactor auth', 'terminal')
  })

  it('disables the VS Code option and defaults to Terminal when the code CLI is unavailable', () => {
    const { onLaunch } = setup({ hasVSCode: false })
    expect(screen.getByLabelText('VS Code')).toBeDisabled()
    expect(screen.getByLabelText('Terminal')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    expect(onLaunch).toHaveBeenCalledWith('', 'terminal')
  })

  it('shows the clone-mode note only when VS Code is selected in clone mode', () => {
    setup({ cloneMode: true }) // VS Code is the default opener → note shows immediately
    expect(screen.getByText(/in clone mode/i)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Terminal'))
    expect(screen.queryByText(/in clone mode/i)).toBeNull()
  })

  it('cancels without launching', () => {
    const { onLaunch, onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onLaunch).not.toHaveBeenCalled()
  })
})
