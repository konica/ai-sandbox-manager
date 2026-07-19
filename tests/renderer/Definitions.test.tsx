import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Definitions } from '../../src/renderer/screens/Definitions'
import type { Definition } from '@shared/types'

const defs: Definition[] = [
  { id: 'd1', name: 'prj-alpha', description: '', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' }
]

describe('Definitions screen', () => {
  it('lists definitions with their base image and tier', () => {
    render(<Definitions definitions={defs} onCreate={() => {}} />)
    expect(screen.getByText('prj-alpha')).toBeInTheDocument()
    expect(screen.getByText('docker/sandbox-templates:claude-code-docker')).toBeInTheDocument()
    expect(screen.getByText('Locked Down')).toBeInTheDocument()
  })

  it('shows the empty state when there are none', () => {
    render(<Definitions definitions={[]} onCreate={() => {}} />)
    expect(screen.getByText(/no definitions yet/i)).toBeInTheDocument()
  })

  it('invokes onCreate when the create button is clicked', () => {
    const onCreate = vi.fn()
    render(<Definitions definitions={[]} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('invokes onLaunch with the definition id', () => {
    const onLaunch = vi.fn()
    render(<Definitions definitions={defs} onCreate={() => {}} onLaunch={onLaunch} />)
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    expect(onLaunch).toHaveBeenCalledWith('d1')
  })

  it('invokes onEdit with the definition id', () => {
    const onEdit = vi.fn()
    render(<Definitions definitions={defs} onCreate={() => {}} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledWith('d1')
  })
})
