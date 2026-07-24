import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GlobalSecrets } from '../../src/renderer/screens/GlobalSecrets'

describe('GlobalSecrets', () => {
  it('lists secrets and adds one', () => {
    const onAdd = vi.fn(); const onRemove = vi.fn()
    render(<GlobalSecrets secrets={[{ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: 't' }]} onAdd={onAdd} onRemove={onRemove} envHits={[]} onImport={vi.fn()} />)
    expect(screen.getByRole('button', { name: /remove/i }).closest('div')?.textContent).toContain('OpenAI') // secret is listed
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'sk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledWith('anthropic', 'sk')
  })
  it('removes a secret', () => {
    const onRemove = vi.fn()
    render(<GlobalSecrets secrets={[{ id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', store: 'sbx', createdAt: 't' }]} onAdd={vi.fn()} onRemove={onRemove} envHits={[]} onImport={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onRemove).toHaveBeenCalledWith('openai')
  })
  it('lists detected env hits and imports a selected one', () => {
    const onImport = vi.fn()
    render(<GlobalSecrets secrets={[]} onAdd={vi.fn()} onRemove={vi.fn()} onImport={onImport}
      envHits={[{ serviceId: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', masked: 'sk-ant…' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /import from environment/i })) // expand
    fireEvent.click(screen.getByLabelText(/Anthropic/i))                              // select the hit
    fireEvent.click(screen.getByRole('button', { name: 'Import selected' }))
    expect(onImport).toHaveBeenCalledWith('anthropic')
  })
})
