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
  it('defaults the name to the derived definition name and offers Launch new when free', () => {
    const { onLaunch } = setup(['other'])
    expect(screen.getByLabelText('Session name')).toHaveValue('my-project')
    fireEvent.click(screen.getByRole('button', { name: /launch new/i }))
    expect(onLaunch).toHaveBeenCalledWith('my-project')
  })

  it('offers Attach & Resume when the name matches an existing sandbox', () => {
    const { onAttach, onLaunch } = setup(['my-project'])
    fireEvent.click(screen.getByRole('button', { name: /attach & resume/i }))
    expect(onAttach).toHaveBeenCalledWith('my-project')
    expect(onLaunch).not.toHaveBeenCalled()
  })

  it('lets the user type a new name to create a separate instance', () => {
    const { onLaunch } = setup(['my-project'])
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'my-project-2' } })
    fireEvent.click(screen.getByRole('button', { name: /launch new/i }))
    expect(onLaunch).toHaveBeenCalledWith('my-project-2')
  })

  it('disables the primary action when the name is empty', () => {
    setup([])
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: /launch new/i })).toBeDisabled()
  })
})
