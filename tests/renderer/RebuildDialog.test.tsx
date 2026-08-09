import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RebuildDialog, rebuildInitialDiskSize } from '../../src/renderer/components/RebuildDialog'

describe('rebuildInitialDiskSize', () => {
  it('prefers the instance size, then the definition default, then blank', () => {
    expect(rebuildInitialDiskSize('20g', '10g')).toBe('20g')
    expect(rebuildInitialDiskSize(undefined, '10g')).toBe('10g')
    expect(rebuildInitialDiskSize(undefined, undefined)).toBe('')
  })
})

describe('RebuildDialog', () => {
  function setup(initialDiskSize = '20g') {
    const onRebuild = vi.fn(); const onCancel = vi.fn()
    render(<RebuildDialog name="box" initialDiskSize={initialDiskSize} onRebuild={onRebuild} onCancel={onCancel} />)
    return { onRebuild, onCancel }
  }
  it('pre-fills the disk field and rebuilds with it', () => {
    const { onRebuild } = setup('20g')
    expect(screen.getByLabelText('Disk size')).toHaveValue('20g')
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))
    expect(onRebuild).toHaveBeenCalledWith('20g')
  })
  it('lets the user change the size', () => {
    const { onRebuild } = setup('20g')
    fireEvent.change(screen.getByLabelText('Disk size'), { target: { value: '40g' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))
    expect(onRebuild).toHaveBeenCalledWith('40g')
  })
  it('disables Rebuild and shows an error on an invalid size, and keeps empty valid', () => {
    setup('')
    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeEnabled() // empty = Docker default
    fireEvent.change(screen.getByLabelText('Disk size'), { target: { value: '40gb' } })
    expect(screen.getByText(/binary size like/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeDisabled()
  })
  it('cancels', () => {
    const { onRebuild, onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onRebuild).not.toHaveBeenCalled()
  })
})
