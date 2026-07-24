import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CredentialStorageGuide } from '../../src/renderer/screens/CredentialStorageGuide'

describe('CredentialStorageGuide', () => {
  it('shows the macOS Keychain message', () => {
    render(<CredentialStorageGuide status={{ platform: 'darwin', backend: 'keychain', secure: true }} />)
    expect(screen.getByText(/macOS Keychain/i)).toBeInTheDocument()
  })
  it('warns and offers a fix on insecure Linux', () => {
    render(<CredentialStorageGuide status={{ platform: 'linux', backend: 'basic_text', secure: false }} />)
    expect(screen.getByText(/can’t be stored securely/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enable a secure keyring/i })).toBeInTheDocument()
  })
})
