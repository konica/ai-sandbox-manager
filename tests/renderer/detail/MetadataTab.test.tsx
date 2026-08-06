import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetadataTab } from '../../../src/renderer/screens/detail/MetadataTab'

describe('MetadataTab', () => {
  it('renders existing tags and calls onChange when a tag is added', () => {
    const onChange = vi.fn()
    render(<MetadataTab tags={['prod']} onChange={onChange} />)
    expect(screen.getByText('prod')).toBeTruthy()
    const input = screen.getByLabelText('Edit instance tags')
    fireEvent.change(input, { target: { value: 'eu' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['prod', 'eu'])
  })
})
