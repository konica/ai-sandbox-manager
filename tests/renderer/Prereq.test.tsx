import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Prereq } from '../../src/renderer/screens/Prereq'
import type { PrereqResult } from '@shared/types'

const failing: PrereqResult = {
  ok: false,
  checks: [
    { id: 'docker', ok: true, value: 'Docker version 24' },
    { id: 'auth', ok: false }
  ]
}

describe('Prereq screen', () => {
  it('renders translated labels and remediation for failures', () => {
    render(<Prereq result={failing} onRecheck={() => {}} />)
    expect(screen.getByText('Docker Engine')).toBeInTheDocument()
    expect(screen.getByText('Sandboxes Authentication')).toBeInTheDocument()
    expect(screen.getByText(/sbx login/)).toBeInTheDocument()
  })

  it('invokes onRecheck when the retry button is clicked', () => {
    const onRecheck = vi.fn()
    render(<Prereq result={failing} onRecheck={onRecheck} />)
    screen.getByRole('button', { name: /retry all checks/i }).click()
    expect(onRecheck).toHaveBeenCalledOnce()
  })

  it('offers Continue Anyway when onContinue is provided', () => {
    const onContinue = vi.fn()
    render(<Prereq result={failing} onRecheck={() => {}} onContinue={onContinue} />)
    screen.getByRole('button', { name: /continue anyway/i }).click()
    expect(onContinue).toHaveBeenCalledOnce()
  })
})
