import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MonitoringTab } from '../../../src/renderer/screens/detail/MonitoringTab'

const summary = {
  allowed: 42, blocked: 3, events: [
    { at: '2026-07-19T10:15:23', host: 'api.anthropic.com:443', allowed: true, reason: 'domain-allowed' },
    { at: '2026-07-19T10:15:15', host: 'telemetry.example.com:443', allowed: false, reason: 'default deny' }
  ]
}

describe('MonitoringTab', () => {
  it('shows counters and traffic rows', () => {
    render(<MonitoringTab summary={summary} onAllow={vi.fn()} />)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('api.anthropic.com:443')).toBeInTheDocument()
    expect(screen.getByText('telemetry.example.com:443')).toBeInTheDocument()
  })
  it('allows a blocked domain in real time', () => {
    const onAllow = vi.fn()
    render(<MonitoringTab summary={summary} onAllow={onAllow} />)
    fireEvent.click(screen.getByRole('button', { name: /allow/i }))
    expect(onAllow).toHaveBeenCalledWith('telemetry.example.com:443')
  })
  it('shows an empty state with no events', () => {
    render(<MonitoringTab summary={{ allowed: 0, blocked: 0, events: [] }} onAllow={vi.fn()} />)
    expect(screen.getByText(/no.*traffic/i)).toBeInTheDocument()
  })
})
