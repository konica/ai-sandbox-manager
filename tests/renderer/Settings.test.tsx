import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const prefsGet = vi.fn()
const prefsSet = vi.fn()
vi.mock('../../src/renderer/ipc/client', () => ({
  api: {
    prefsGet: (k: string) => prefsGet(k),
    prefsSet: (k: string, v: string) => prefsSet(k, v),
    secretListGlobal: async () => ({ ok: true, data: [] }),
    secretSetGlobal: async () => ({ ok: true, data: null }),
    secretRemoveGlobal: async () => ({ ok: true, data: null }),
    credScanEnv: async () => ({ ok: true, data: [] }),
    secretSetGlobalFromEnv: async () => ({ ok: true, data: null }),
    authStatus: async () => ({ ok: true, data: { anthropic: 'none' } }),
    authSignOut: async () => ({ ok: true, data: null }),
    authStartLogin: async () => ({ ok: true, data: { name: 'x' } }),
    credsStorageStatus: async () => ({ ok: true, data: { platform: 'darwin', backend: 'keychain', secure: true } })
  }
}))

import { Settings } from '../../src/renderer/screens/Settings'

beforeEach(() => {
  prefsGet.mockReset().mockResolvedValue({ ok: true, data: 'balanced' })
  prefsSet.mockReset().mockResolvedValue({ ok: true, data: null })
})

describe('Settings — default tier', () => {
  it('reflects the saved default tier', async () => {
    render(<Settings />)
    await waitFor(() => expect(screen.getByRole('button', { name: /balanced/i })).toHaveAttribute('aria-pressed', 'true'))
  })
  it('persists a new default tier on click', async () => {
    render(<Settings />)
    await waitFor(() => screen.getByRole('button', { name: /open/i }))
    fireEvent.click(screen.getByRole('button', { name: /open/i }))
    await waitFor(() => expect(prefsSet).toHaveBeenCalledWith('defaultTier', 'open'))
  })
})
