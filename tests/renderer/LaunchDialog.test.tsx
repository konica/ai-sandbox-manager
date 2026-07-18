import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LaunchDialog } from '../../src/renderer/components/LaunchDialog'
import type { Definition } from '../../src/shared/types'

const def: Definition = { id: 'd1', name: 'My Project', description: '', baseImage: 'img:tag', tier: 'locked', createdAt: '2026-01-01T00:00:00.000Z' }

function setup(existingNames: string[]) {
  const onLaunch = vi.fn(); const onAttach = vi.fn(); const onCancel = vi.fn()
  render(<LaunchDialog definition={def} existingNames={existingNames} onLaunch={onLaunch} onAttach={onAttach} onCancel={onCancel} />)
  return { onLaunch, onAttach, onCancel }
}

describe('LaunchDialog', () => {
  it('leaves the sandbox name blank (auto) and defaults session to the definition name', () => {
    const { onLaunch } = setup(['other'])
    expect(screen.getByLabelText('Sandbox name')).toHaveValue('')
    expect(screen.getByLabelText('Session name')).toHaveValue('My Project')
    fireEvent.click(screen.getByRole('button', { name: /launch new/i }))
    // blank sandbox → backend auto-generates; session passed through
    expect(onLaunch).toHaveBeenCalledWith('', 'My Project')
  })

  it('offers Attach & Resume when an existing sandbox name is chosen', () => {
    const { onAttach, onLaunch } = setup(['my-project'])
    fireEvent.change(screen.getByLabelText('Sandbox name'), { target: { value: 'my-project' } })
    fireEvent.click(screen.getByRole('button', { name: /attach & resume/i }))
    expect(onAttach).toHaveBeenCalledWith('my-project')
    expect(onLaunch).not.toHaveBeenCalled()
  })

  it('disables the session field once an existing sandbox is chosen (latest resumes)', () => {
    setup(['my-project'])
    expect(screen.getByLabelText('Session name')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Sandbox name'), { target: { value: 'my-project' } })
    expect(screen.getByLabelText('Session name')).toBeDisabled()
  })

  it('lets the user type a custom sandbox name and session name', () => {
    const { onLaunch } = setup(['my-project'])
    fireEvent.change(screen.getByLabelText('Sandbox name'), { target: { value: 'my-project-2' } })
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Second run' } })
    fireEvent.click(screen.getByRole('button', { name: /launch new/i }))
    expect(onLaunch).toHaveBeenCalledWith('my-project-2', 'Second run')
  })

  it('keeps the primary action enabled even with a blank sandbox name', () => {
    setup([])
    expect(screen.getByRole('button', { name: /launch new/i })).toBeEnabled()
  })
})
