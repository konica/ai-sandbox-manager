import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MonitoringTab } from '../../../src/renderer/screens/detail/MonitoringTab'

const summary = {
  allowed: 42, blocked: 5, events: [
    { at: '2026-07-19T10:15:23', host: 'api.anthropic.com:443', allowed: true, reason: 'domain-allowed', count: 40 },
    { at: '2026-07-19T10:15:15', host: 'telemetry.example.com:443', allowed: false, reason: 'default deny', count: 7 }
  ]
}
const base = { onAllow: vi.fn(), onDeny: vi.fn() }

describe('MonitoringTab', () => {
  it('shows request counts, domain-count labels, and a time column', () => {
    render(<MonitoringTab summary={summary} {...base} />)
    expect(screen.getByText('42')).toBeInTheDocument() // allowed requests
    expect(screen.getByText('5')).toBeInTheDocument()  // blocked requests
    expect(screen.getByText('Allowed requests')).toBeInTheDocument()
    expect(screen.getByText('Blocked requests')).toBeInTheDocument()
    // "Allowed/Blocked domains" appears in both the counter and the breakdown group
    expect(screen.getAllByText('Allowed domains').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('columnheader', { name: /time/i })).toBeInTheDocument()
  })
  it('allows a blocked domain and denies an allowed one', () => {
    const onAllow = vi.fn(); const onDeny = vi.fn()
    render(<MonitoringTab summary={summary} onAllow={onAllow} onDeny={onDeny} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Allow' })[0])
    expect(onAllow).toHaveBeenCalledWith('telemetry.example.com:443')
    fireEvent.click(screen.getAllByRole('button', { name: 'Deny' })[0])
    expect(onDeny).toHaveBeenCalledWith('api.anthropic.com:443')
  })
  it('breaks down allowed and blocked domains with per-domain request counts', () => {
    render(<MonitoringTab summary={summary} {...base} />)
    expect(screen.getByRole('heading', { name: /allowed domains/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /blocked domains/i })).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument() // api.anthropic requests
    expect(screen.getByText('7')).toBeInTheDocument()  // telemetry requests
  })
  it('shows an empty state with no events', () => {
    render(<MonitoringTab summary={{ allowed: 0, blocked: 0, events: [] }} {...base} />)
    expect(screen.getByText(/no.*traffic/i)).toBeInTheDocument()
  })
})
