import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const pickFile = vi.fn(async () => '/Users/me/pick.sh')
vi.mock('../../../src/renderer/ipc/client', () => ({
  api: {
    pickFile: () => pickFile(),
    pickFolder: async () => null,
    credScanEnv: async () => ({ ok: true, data: [] }),
    sshDetect: async () => ({ ok: true, data: { present: false } }),
    prefsGet: async () => ({ ok: true, data: null })
  }
}))

import { CreateDefinition } from '../../../src/renderer/wizard/CreateDefinition'

beforeEach(() => { pickFile.mockClear() })

describe('CreateDefinition copy-files section', () => {
  it('adds a copy row and fills the host path via the file picker', async () => {
    render(<CreateDefinition onDone={vi.fn()} onCancel={vi.fn()} />)
    // Step 1 is shown by default; add a copy row
    fireEvent.click(screen.getByRole('button', { name: /add file to copy/i }))
    const host = screen.getByLabelText('Copy host path 0') as HTMLInputElement
    expect(host).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^file…$/i }))
    await screen.findByDisplayValue('/Users/me/pick.sh')
    expect(pickFile).toHaveBeenCalled()
  })
})
