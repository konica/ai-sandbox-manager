import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetadataTab } from '../../../src/renderer/screens/detail/MetadataTab'

describe('MetadataTab', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z')) })
  afterEach(() => { vi.useRealTimers() })

  it('renders existing tags and calls onChange when a tag is added', () => {
    const onChange = vi.fn()
    render(<MetadataTab tags={['prod']} onChange={onChange} createdAt={null} />)
    expect(screen.getByText('prod')).toBeTruthy()
    const input = screen.getByLabelText('Edit instance tags')
    fireEvent.change(input, { target: { value: 'eu' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['prod', 'eu'])
  })

  it('shows relative created time with an absolute-time tooltip', () => {
    const threeHoursAgo = new Date('2026-08-06T09:00:00.000Z').toISOString()
    render(<MetadataTab tags={[]} onChange={vi.fn()} createdAt={threeHoursAgo} />)
    const el = screen.getByText('3 hours ago')
    expect(el.getAttribute('title')).toBe(new Date(threeHoursAgo).toLocaleString())
  })

  it('shows "Unknown" when createdAt is null', () => {
    render(<MetadataTab tags={[]} onChange={vi.fn()} createdAt={null} />)
    expect(screen.getByText('Unknown')).toBeTruthy()
  })
})
