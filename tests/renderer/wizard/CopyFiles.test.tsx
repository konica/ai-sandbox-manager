import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const pickFile = vi.fn(async () => '/Users/me/pick.sh')
const pickFolder = vi.fn(async () => '/Users/me/dir')
vi.mock('../../../src/renderer/ipc/client', () => ({
  api: {
    pickFile: () => pickFile(),
    pickFolder: () => pickFolder(),
    credScanEnv: async () => ({ ok: true, data: [] }),
    sshDetect: async () => ({ ok: true, data: { present: false } }),
    prefsGet: async () => ({ ok: true, data: null }),
    hostCapacity: async () => ({ ok: true, data: { cpuCores: 0, totalMemBytes: 0 } })
  }
}))

import { CreateDefinition } from '../../../src/renderer/wizard/CreateDefinition'

beforeEach(() => { pickFile.mockClear(); pickFolder.mockClear() })

describe('CreateDefinition copy-files section', () => {
  it('adds an entry from the add-row and shows it as a read-only pill', async () => {
    render(<CreateDefinition onDone={vi.fn()} onCancel={vi.fn()} />)
    // Step 1 is shown by default. Fill the add-row and click Add.
    fireEvent.change(screen.getByLabelText('Copy host source path'), { target: { value: '~/.gitconfig' } })
    fireEvent.change(screen.getByLabelText('Copy sandbox destination'), { target: { value: '/home/user/.gitconfig' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    // The entry appears; the add-row inputs clear.
    expect(await screen.findByText('/home/user/.gitconfig')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove ~\/\.gitconfig/ })).toBeInTheDocument()
    expect((screen.getByLabelText('Copy host source path') as HTMLInputElement).value).toBe('')
  })

  it('fills the host path via Browse… → Select file', async () => {
    render(<CreateDefinition onDone={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse host source path' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /select file/i }))
    await screen.findByDisplayValue('/Users/me/pick.sh')
    expect(pickFile).toHaveBeenCalled()
  })
})
