import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmModal } from '../../src/renderer/components/ConfirmModal'

describe('ConfirmModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmModal open={false} title="T" body="B" confirmLabel="Yes" cancelLabel="No" onConfirm={() => {}} onCancel={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })
  it('fires onConfirm and onCancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmModal open title="Remove?" body="Are you sure" confirmLabel="Yes" cancelLabel="No" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Yes'))
    fireEvent.click(screen.getByText('No'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
