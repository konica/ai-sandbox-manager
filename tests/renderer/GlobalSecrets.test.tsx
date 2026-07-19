import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GlobalSecrets } from '../../src/renderer/screens/GlobalSecrets'

describe('GlobalSecrets', () => {
  it('lists secrets and adds one', () => {
    const onAdd = vi.fn(); const onRemove = vi.fn()
    render(<GlobalSecrets secrets={[{ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: 't' }]} onAdd={onAdd} onRemove={onRemove} />)
    expect(screen.getByRole('button', { name: /remove/i }).closest('div')?.textContent).toContain('OpenAI') // secret is listed
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledWith('anthropic', 'sk')
  })
  it('removes a secret', () => {
    const onRemove = vi.fn()
    render(<GlobalSecrets secrets={[{ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: 't' }]} onAdd={vi.fn()} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onRemove).toHaveBeenCalledWith('openai')
  })
})
