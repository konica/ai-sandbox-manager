import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TagInput } from '../../src/renderer/components/TagInput'

describe('TagInput', () => {
  it('adds a tag on Enter', () => {
    const onChange = vi.fn()
    render(<TagInput tags={[]} onChange={onChange} ariaLabel="Tags" />)
    const input = screen.getByLabelText('Tags')
    fireEvent.change(input, { target: { value: 'prod' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['prod'])
  })
  it('ignores a case-insensitive duplicate', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['prod']} onChange={onChange} ariaLabel="Tags" />)
    const input = screen.getByLabelText('Tags')
    fireEvent.change(input, { target: { value: 'PROD' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })
  it('removes a tag via its remove button', () => {
    const onChange = vi.fn()
    render(<TagInput tags={['prod', 'eu']} onChange={onChange} ariaLabel="Tags" />)
    fireEvent.click(screen.getByLabelText('Remove tag prod'))
    expect(onChange).toHaveBeenCalledWith(['eu'])
  })
})
