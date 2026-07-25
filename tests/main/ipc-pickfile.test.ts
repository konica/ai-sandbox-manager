import { describe, it, expect, vi } from 'vitest'

const handlers: Record<string, unknown> = {}
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: unknown) => { handlers[ch] = fn } },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/picked/file.sh'] })) },
  BrowserWindow: { fromWebContents: () => null }
}))

import { registerIpc } from '../../src/main/ipc'

describe('dialog:pickFile', () => {
  it('is registered and returns the chosen path', async () => {
    registerIpc({ adapter: {} as never, store: {} as never, probes: {} as never, openTerminal: () => {} } as never)
    const fn = handlers['dialog:pickFile'] as (e: unknown) => Promise<string | null>
    expect(typeof fn).toBe('function')
    expect(await fn({ sender: {} })).toBe('/picked/file.sh')
  })
})
