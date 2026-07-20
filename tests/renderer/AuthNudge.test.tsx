import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuthNudge } from '../../src/renderer/components/AuthNudge'
import type { Definition } from '../../src/shared/types'

const def: Definition = { id: 'd', name: 'My Project', description: '', baseImage: 'i', tier: 'locked', createdAt: 't' }

describe('AuthNudge', () => {
  it('routes the three actions', () => {
    const onProceed = vi.fn(); const onSignIn = vi.fn(); const onUseKey = vi.fn()
    render(<AuthNudge definition={def} onProceed={onProceed} onSignIn={onSignIn} onUseKey={onUseKey} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /launch — sign in when it opens/i }))
    expect(onProceed).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /sign in first/i }))
    expect(onSignIn).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /use an api key/i }))
    expect(onUseKey).toHaveBeenCalled()
  })
})
