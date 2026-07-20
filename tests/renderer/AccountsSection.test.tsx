import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const authStatus = vi.fn()
const authStartLogin = vi.fn()
const authSignOut = vi.fn()
vi.mock('../../src/renderer/ipc/client', () => ({
  api: {
    authStatus: () => authStatus(),
    authStartLogin: () => authStartLogin(),
    authSignOut: () => authSignOut()
  }
}))

import { AccountsSection } from '../../src/renderer/screens/AccountsSection'

beforeEach(() => {
  authStatus.mockReset().mockResolvedValue({ ok: true, data: { anthropic: 'none' } })
  authStartLogin.mockReset().mockResolvedValue({ ok: true, data: { name: 'sbx-oauth-login' } })
  authSignOut.mockReset().mockResolvedValue({ ok: true, data: null })
})

describe('AccountsSection', () => {
  it('shows Not signed in and a Sign in button, and calls startLogin', async () => {
    render(<AccountsSection />)
    await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(authStartLogin).toHaveBeenCalled()
  })
  it('shows Signed in (OAuth) and a Sign out button when authed', async () => {
    authStatus.mockResolvedValue({ ok: true, data: { anthropic: 'oauth' } })
    render(<AccountsSection />)
    await waitFor(() => expect(screen.getByText(/signed in \(oauth\)/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(authSignOut).toHaveBeenCalled()
  })
})
