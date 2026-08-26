import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SessionBackups } from '../../src/renderer/screens/detail/SessionBackups'
import { LanguageProvider } from '../../src/renderer/i18n'
import { api } from '../../src/renderer/ipc/client'

function renderCard(name = 'xray-old'): void {
  render(<LanguageProvider><SessionBackups name={name} /></LanguageProvider>)
}

const ONE = [{ dir: 'C:/archives/xray-a', sbxName: 'xray-a', capturedAt: '2026-08-26T01:00:00.000Z' }]

beforeEach(() => { vi.restoreAllMocks() })

describe('SessionBackups', () => {
  it('lists a backup with the instance it came from', async () => {
    vi.spyOn(api, 'sessionListArchives').mockResolvedValue({ ok: true, data: ONE })

    renderCard()

    expect(await screen.findByText(/xray-a/)).toBeInTheDocument()
  })

  it('renders nothing at all when there are no backups', async () => {
    // Instances that never had sessions must look exactly as they did before this feature.
    vi.spyOn(api, 'sessionListArchives').mockResolvedValue({ ok: true, data: [] })

    const { container } = render(<LanguageProvider><SessionBackups name="fresh" /></LanguageProvider>)

    await waitFor(() => expect(api.sessionListArchives).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('renders nothing when the list cannot be read', async () => {
    vi.spyOn(api, 'sessionListArchives').mockResolvedValue({ ok: false, error: { kind: 'generic', message: 'nope' } })

    const { container } = render(<LanguageProvider><SessionBackups name="broken" /></LanguageProvider>)

    await waitFor(() => expect(api.sessionListArchives).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('exports the archive the button belongs to', async () => {
    vi.spyOn(api, 'sessionListArchives').mockResolvedValue({ ok: true, data: ONE })
    const exportArchive = vi.spyOn(api, 'sessionExportArchive').mockResolvedValue({ ok: true, data: { path: 'D:/out/xray-a' } })

    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: /export/i }))

    await waitFor(() => expect(exportArchive).toHaveBeenCalledWith('C:/archives/xray-a'))
  })

  it('confirms where the backup was written', async () => {
    vi.spyOn(api, 'sessionListArchives').mockResolvedValue({ ok: true, data: ONE })
    vi.spyOn(api, 'sessionExportArchive').mockResolvedValue({ ok: true, data: { path: 'D:/out/xray-a' } })

    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: /export/i }))

    expect(await screen.findByText(/D:\/out\/xray-a/)).toBeInTheDocument()
  })

  it('says nothing when the export was cancelled', async () => {
    vi.spyOn(api, 'sessionListArchives').mockResolvedValue({ ok: true, data: ONE })
    vi.spyOn(api, 'sessionExportArchive').mockResolvedValue({ ok: true, data: { canceled: true } })

    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: /export/i }))

    await waitFor(() => expect(api.sessionExportArchive).toHaveBeenCalled())
    expect(screen.queryByText(/Saved to/i)).not.toBeInTheDocument()
  })
})
