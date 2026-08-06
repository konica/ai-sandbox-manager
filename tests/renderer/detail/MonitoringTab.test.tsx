import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MonitoringTab } from '../../../src/renderer/screens/detail/MonitoringTab'
import type { PolicySummary } from '../../../src/shared/types'

const summary = {
  allowed: 42, blocked: 5, events: [
    { at: '2026-07-19T10:15:23', host: 'api.anthropic.com:443', allowed: true, reason: 'domain-allowed', proxyType: 'forward', count: 40 },
    { at: '2026-07-19T10:15:15', host: 'telemetry.example.com:443', allowed: false, reason: 'default deny', proxyType: 'forward-bypass', count: 7 }
  ]
}
const base = { onAllow: vi.fn(), onDeny: vi.fn() }
const statsProps = { stats: { status: 'idle' as const }, running: true, onFetchStats: () => {} }

describe('MonitoringTab', () => {
  it('shows request counts, domain-count labels, and a time column', () => {
    render(<MonitoringTab summary={summary} {...base} {...statsProps} />)
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
    render(<MonitoringTab summary={summary} onAllow={onAllow} onDeny={onDeny} {...statsProps} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Allow' })[0])
    expect(onAllow).toHaveBeenCalledWith('telemetry.example.com:443')
    fireEvent.click(screen.getAllByRole('button', { name: 'Deny' })[0])
    expect(onDeny).toHaveBeenCalledWith('api.anthropic.com:443')
  })
  it('breaks down allowed and blocked domains with per-domain request counts', () => {
    render(<MonitoringTab summary={summary} {...base} {...statsProps} />)
    expect(screen.getByRole('heading', { name: /allowed domains/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /blocked domains/i })).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument() // api.anthropic requests
    expect(screen.getByText('7')).toBeInTheDocument()  // telemetry requests
  })
  it('shows an empty state with no events', () => {
    render(<MonitoringTab summary={{ allowed: 0, blocked: 0, events: [] }} {...base} {...statsProps} />)
    expect(screen.getByText(/no traffic recorded/i)).toBeInTheDocument()
  })
  it('shows the proxy type as a badge with an explanatory tooltip', () => {
    render(<MonitoringTab summary={summary} {...base} {...statsProps} />)
    const forward = screen.getAllByText('Forward')
    expect(forward.length).toBeGreaterThanOrEqual(1)
    expect(forward[0]).toHaveAttribute('title', expect.stringContaining('credential injection'))
  })
  it('color-codes the proxy tone (forward-bypass = warn)', () => {
    render(<MonitoringTab summary={summary} {...base} {...statsProps} />)
    const bypass = screen.getAllByText('Forward (bypass)')
    expect(bypass.some((el) => el.className.includes('proxy-badge') && el.className.includes('warn'))).toBe(true)
  })
  it('renders the proxy-types legend with all five entries and a docs link', () => {
    render(<MonitoringTab summary={summary} {...base} {...statsProps} />)
    expect(screen.getByText('Proxy types')).toBeInTheDocument()
    expect(screen.getByText('Transparent')).toBeInTheDocument()
    expect(screen.getByText('Network')).toBeInTheDocument()
    expect(screen.getByText('Browser open')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /learn more/i })).toHaveAttribute('href', expect.stringContaining('docs.docker.com'))
  })
})

const emptySummary: PolicySummary = { allowed: 0, blocked: 0, events: [] }
const baseStats = { summary: emptySummary, onAllow: () => {}, onDeny: () => {} }

describe('MonitoringTab resource usage', () => {
  it('disables Fetch when the instance is not running', () => {
    render(<MonitoringTab {...baseStats} running={false} stats={{ status: 'idle' }} onFetchStats={() => {}} />)
    expect((screen.getByRole('button', { name: 'Fetch' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('calls onFetchStats when Fetch is clicked (running)', () => {
    const onFetchStats = vi.fn()
    render(<MonitoringTab {...baseStats} running={true} stats={{ status: 'idle' }} onFetchStats={onFetchStats} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    expect(onFetchStats).toHaveBeenCalled()
  })
  it('renders CPU/memory/disk tiles from ready stats, with "no limit" and "Unavailable"', () => {
    render(<MonitoringTab {...baseStats} running={true} onFetchStats={() => {}}
      stats={{ status: 'ready', at: '2026-08-06T14:03:20.000Z', data: {
        cpu: { cores: 0.5, ofCpus: 4 },
        memory: { usedBytes: 314572800, limitBytes: null },
        disk: null
      } }} />)
    expect(screen.getByText('0.50 cores')).toBeTruthy()
    expect(screen.getByText(/300\.0 MB/)).toBeTruthy()
    expect(screen.getByText(/no limit/)).toBeTruthy()
    // disk was null → Unavailable appears at least once
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })
  it('shows the error message on a failed fetch', () => {
    render(<MonitoringTab {...baseStats} running={true} onFetchStats={() => {}} stats={{ status: 'error', message: 'not running' }} />)
    expect(screen.getByText(/not running/)).toBeTruthy()
  })
})
