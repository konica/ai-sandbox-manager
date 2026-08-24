import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// `src/renderer/ipc/client` resolves `api` from `globalThis.api` once, at module-eval time,
// so assigning `globalThis.api` in a hook is too late — the component would see the
// "IPC unavailable" fallbacks. Mock the module instead, as the other renderer tests do.
const api = vi.hoisted(() => ({
  captureSettingsGet: vi.fn(async () => ({ ok: true, data: { caPath: '', proxyPort: 8080, upstreamPort: 3128 } })),
  captureSettingsSet: vi.fn(async (patch: Record<string, unknown>) => ({ ok: true, data: { caPath: '', proxyPort: 8080, upstreamPort: 3128, ...patch } })),
  captureCaInspect: vi.fn(async () => ({ ok: true, data: { pem: 'P', subject: 'CN=PortSwigger CA', commonName: 'PortSwigger CA', expires: 'Aug 21 2036 GMT' } })),
  captureBurpConfig: vi.fn(async () => ({ ok: true, data: '{"user_options":{}}' })),
  captureExportConfig: vi.fn(async () => ({ ok: true, data: { path: 'C:/out.json' } })),
  pickFile: vi.fn(async () => 'C:/burp.cer')
}))
vi.mock('../../src/renderer/ipc/client', () => ({ api }))

import { BurpSettings } from '../../src/renderer/screens/BurpSettings'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BurpSettings', () => {
  it('renders the CA and proxy-port fields', async () => {
    render(<BurpSettings />)
    expect(await screen.findByLabelText(/burp ca certificate/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/burp proxy port/i)).toBeInTheDocument()
  })

  it('picks a CA file, saves it, and confirms with the parsed subject and expiry', async () => {
    render(<BurpSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /choose file/i }))
    await waitFor(() => expect(api.captureSettingsSet).toHaveBeenCalledWith({ caPath: 'C:/burp.cer' }))
    expect(await screen.findByText(/PortSwigger CA/)).toBeInTheDocument()
    expect(screen.getByText(/2036/)).toBeInTheDocument()
  })

  it('shows a parse error instead of a confirmation when the file is not a certificate', async () => {
    api.captureCaInspect.mockResolvedValueOnce({ ok: false, error: { kind: 'generic', message: 'not a valid certificate' } } as never)
    render(<BurpSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /choose file/i }))
    expect(await screen.findByText(/not a valid certificate/i)).toBeInTheDocument()
  })

  it('saves an edited proxy port on blur', async () => {
    render(<BurpSettings />)
    const input = await screen.findByLabelText(/burp proxy port/i)
    fireEvent.change(input, { target: { value: '8081' } })
    fireEvent.blur(input)
    await waitFor(() => expect(api.captureSettingsSet).toHaveBeenCalledWith({ proxyPort: 8081 }))
  })

  it('does not save an invalid port', async () => {
    render(<BurpSettings />)
    const input = await screen.findByLabelText(/burp proxy port/i)
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    await waitFor(() => expect(api.captureSettingsSet).not.toHaveBeenCalled())
  })

  it('exposes the upstream port only under Advanced', async () => {
    render(<BurpSettings />)
    await screen.findByLabelText(/burp proxy port/i)
    expect(screen.queryByLabelText(/upstream port/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }))
    expect(screen.getByLabelText(/upstream port/i)).toBeInTheDocument()
  })

  it('explains the upstream rule and saves the config to a file', async () => {
    render(<BurpSettings />)
    expect(await screen.findByText(/401/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /export burp config/i }))
    await waitFor(() => expect(api.captureExportConfig).toHaveBeenCalled())
  })

  it('copies the config to the clipboard', async () => {
    render(<BurpSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /^copy$/i }))
    await waitFor(() => expect(api.captureBurpConfig).toHaveBeenCalled())
  })

  it('surfaces an export failure', async () => {
    api.captureExportConfig.mockResolvedValueOnce({ ok: false, error: { kind: 'generic', message: 'disk full' } } as never)
    render(<BurpSettings />)
    fireEvent.click(await screen.findByRole('button', { name: /export burp config/i }))
    expect(await screen.findByText(/disk full/i)).toBeInTheDocument()
  })
})
