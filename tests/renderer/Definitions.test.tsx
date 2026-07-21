import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Definitions } from '../../src/renderer/screens/Definitions'
import type { Definition } from '@shared/types'

const defs: Definition[] = [
  { id: 'd1', name: 'prj-alpha', description: '', baseImage: 'docker/sandbox-templates:claude-code-docker', tier: 'locked', createdAt: '2026-07-18T00:00:00Z' }
]

describe('Definitions screen', () => {
  it('lists definitions with their base image and tier', () => {
    render(<Definitions definitions={defs} onCreate={() => {}} />)
    expect(screen.getByText('prj-alpha')).toBeInTheDocument()
    expect(screen.getByText('docker/sandbox-templates:claude-code-docker')).toBeInTheDocument()
    expect(screen.getByText('Locked Down')).toBeInTheDocument()
  })

  it('shows the empty state when there are none', () => {
    render(<Definitions definitions={[]} onCreate={() => {}} />)
    expect(screen.getByText(/no definitions yet/i)).toBeInTheDocument()
  })

  it('invokes onCreate when the create button is clicked', () => {
    const onCreate = vi.fn()
    render(<Definitions definitions={[]} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: /create sandbox/i }))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('invokes onLaunch with the definition id', () => {
    const onLaunch = vi.fn()
    render(<Definitions definitions={defs} onCreate={() => {}} onLaunch={onLaunch} />)
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }))
    expect(onLaunch).toHaveBeenCalledWith('d1')
  })

  it('invokes onEdit with the definition id', () => {
    const onEdit = vi.fn()
    render(<Definitions definitions={defs} onCreate={() => {}} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledWith('d1')
  })
})

const two: Definition[] = [
  { id: 'd1', name: 'Alpha', description: '', baseImage: 'i:t', tier: 'locked', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'd2', name: 'Beta', description: '', baseImage: 'i:t', tier: 'open', createdAt: '2026-01-02T00:00:00Z' }
]

describe('Definitions import/export', () => {
  it('Export is disabled until a row is selected, then exports selected ids', () => {
    const onExport = vi.fn()
    render(<Definitions definitions={two} onCreate={() => {}} onImport={vi.fn()} onExport={onExport} />)
    const headerExport = screen.getByRole('button', { name: /export selected/i })
    expect(headerExport).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Select Alpha'))
    expect(headerExport).not.toBeDisabled()
    fireEvent.click(headerExport)
    expect(onExport).toHaveBeenCalledWith(['d1'])
  })
  it('select-all selects every row and shows the count', () => {
    render(<Definitions definitions={two} onCreate={() => {}} onImport={vi.fn()} onExport={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Select all'))
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument()
  })
  it('per-row Remove calls onRemove with the definition id', () => {
    const onRemove = vi.fn()
    render(<Definitions definitions={two} onCreate={() => {}} onImport={vi.fn()} onExport={vi.fn()} onRemove={onRemove} />)
    fireEvent.click(screen.getByLabelText('Remove Alpha'))
    expect(onRemove).toHaveBeenCalledWith('d1')
  })
  it('has no per-row Export button (export is header/selection only)', () => {
    render(<Definitions definitions={two} onCreate={() => {}} onImport={vi.fn()} onExport={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^export$/i })).toBeNull()
  })
  it('Import calls onImport', () => {
    const onImport = vi.fn()
    render(<Definitions definitions={two} onCreate={() => {}} onImport={onImport} onExport={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(onImport).toHaveBeenCalled()
  })
})
