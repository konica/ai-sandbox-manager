import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FilesTab } from '../../../src/renderer/screens/detail/FilesTab'

function props(over: Partial<React.ComponentProps<typeof FilesTab>> = {}) {
  return {
    running: true,
    hostDir: 'C:\\proj',
    sandboxDir: '/workspace',
    onSetHostDir: vi.fn(),
    onSetSandboxDir: vi.fn(),
    listDir: vi.fn(async () => ({ ok: true as const, cwd: '/workspace', entries: [{ name: 'out', isDir: true }, { name: 'README.md', isDir: false }] })),
    plan: vi.fn(async () => ({ resolvedDest: '/workspace', items: [{ source: 'C:\\proj\\a.txt', resolvedSource: 'C:\\proj\\a.txt', target: '/workspace/a.txt', willOverwrite: false }] })),
    copy: vi.fn(async () => [{ source: 'C:\\proj\\a.txt', ok: true }]),
    pickPaths: vi.fn(async () => ['C:\\proj\\a.txt']),
    pickFolder: vi.fn(async () => null),
    ...over
  }
}

describe('FilesTab', () => {
  it('shows a running hint and disables Copy when stopped', () => {
    render(<FilesTab {...props({ running: false })} />)
    expect(screen.getByText(/start the instance/i)).toBeInTheDocument()
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds a host source via Add files and lists it', async () => {
    const p = props()
    render(<FilesTab {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /add files/i }))
    await waitFor(() => expect(screen.getByText('C:\\proj\\a.txt')).toBeInTheDocument())
    expect(p.pickPaths).toHaveBeenCalledWith('files')
  })

  it('copies directly when the plan has no overwrites', async () => {
    const p = props()
    render(<FilesTab {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /add files/i }))
    await screen.findByText('C:\\proj\\a.txt')
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: '/workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(p.copy).toHaveBeenCalledWith('toSandbox', ['C:\\proj\\a.txt'], '/workspace'))
    await screen.findByText(/copied/i)
  })

  it('uses the sandbox default dir as destination and enables Copy without a typed dest', async () => {
    const p = props() // sandboxDir '/workspace' is the destination default
    render(<FilesTab {...p} />)
    const copyBtn = () => screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement
    expect(copyBtn().disabled).toBe(true) // no sources yet
    fireEvent.click(screen.getByRole('button', { name: /add files/i }))
    await screen.findByText('C:\\proj\\a.txt')
    expect(copyBtn().disabled).toBe(false) // default dir + a source is enough — no typed dest
    fireEvent.click(copyBtn())
    await waitFor(() => expect(p.plan).toHaveBeenCalledWith('toSandbox', ['C:\\proj\\a.txt'], '/workspace'))
  })

  it('shows the overwrite confirm when the plan flags a conflict', async () => {
    const p = props({
      plan: vi.fn(async () => ({ resolvedDest: '/workspace', items: [{ source: 'C:\\proj\\a.txt', resolvedSource: 'C:\\proj\\a.txt', target: '/workspace/a.txt', willOverwrite: true }] }))
    })
    render(<FilesTab {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /add files/i }))
    await screen.findByText('C:\\proj\\a.txt')
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: '/workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await screen.findByText(/overwrite existing files/i)
    expect(p.copy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(p.copy).toHaveBeenCalled())
  })
})
