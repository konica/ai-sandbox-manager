import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Prereq } from '../../src/renderer/screens/Prereq'
import type { PrereqResult } from '@shared/types'

const failing: PrereqResult = {
  ok: false,
  checks: [
    { id: 'docker', label: 'Docker', ok: true, detail: 'ok' },
    { id: 'auth', label: 'sbx authentication', ok: false, detail: 'Not logged in', remediation: 'Run `sbx login`' }
  ]
}

describe('Prereq screen', () => {
  it('renders each check with its label and remediation for failures', () => {
    render(<Prereq result={failing} onRecheck={() => {}} />)
    expect(screen.getByText('Docker')).toBeInTheDocument()
    expect(screen.getByText('sbx authentication')).toBeInTheDocument()
    expect(screen.getByText(/Run `sbx login`/)).toBeInTheDocument()
  })

  it('invokes onRecheck when the button is clicked', () => {
    const onRecheck = vi.fn()
    render(<Prereq result={failing} onRecheck={onRecheck} />)
    screen.getByRole('button', { name: /re-check/i }).click()
    expect(onRecheck).toHaveBeenCalledOnce()
  })
})
