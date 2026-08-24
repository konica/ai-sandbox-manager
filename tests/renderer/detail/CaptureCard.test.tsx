import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CaptureCard } from '../../../src/renderer/screens/detail/CaptureCard'
import { IDLE_STATUS, type CaptureStatus } from '../../../src/shared/capture'

const base = { sandbox: 'demo', running: true, hasCa: true, onEnable: vi.fn(), onDisable: vi.fn(), onOpenShell: vi.fn() }
const onStatus: CaptureStatus = {
  sandbox: 'demo', state: 'on', ports: { proxy: 8080, upstream: 3128, relay: 3129, app: 18080 },
  checks: [
    { id: 'ca', ok: true, detail: 'PortSwigger CA' },
    { id: 'concurrency', ok: true, detail: '12/12' },
    { id: 'credential', ok: true, detail: 'anthropic 200' }
  ]
}

describe('CaptureCard', () => {
  it('offers Enable when off', () => {
    render(<CaptureCard {...base} status={IDLE_STATUS} />)
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeEnabled()
  })

  it('calls onEnable without force', () => {
    const onEnable = vi.fn()
    render(<CaptureCard {...base} onEnable={onEnable} status={IDLE_STATUS} />)
    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }))
    expect(onEnable).toHaveBeenCalledWith(false)
  })

  it('disables Enable with a reason when the sandbox is stopped', () => {
    render(<CaptureCard {...base} running={false} status={IDLE_STATUS} />)
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeDisabled()
    expect(screen.getByText(/must be running/i)).toBeInTheDocument()
  })

  it('disables Enable with a reason when no CA is configured', () => {
    render(<CaptureCard {...base} hasCa={false} status={IDLE_STATUS} />)
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeDisabled()
    expect(screen.getByText(/ca certificate/i)).toBeInTheDocument()
  })

  it('names the occupant when another sandbox is capturing', () => {
    render(<CaptureCard {...base} status={{ ...onStatus, sandbox: 'other' }} />)
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeDisabled()
    expect(screen.getByText(/other is already being captured/i)).toBeInTheDocument()
  })

  it('shows live state, ports and check results when on', () => {
    render(<CaptureCard {...base} status={onStatus} />)
    expect(screen.getByText(/capturing via burp/i)).toBeInTheDocument()
    expect(screen.getByText(/127\.0\.0\.1:8080/)).toBeInTheDocument()
    expect(screen.getByText('12/12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument()
  })

  it('always warns that the running agent is not captured, with a shell action', () => {
    const onOpenShell = vi.fn()
    render(<CaptureCard {...base} status={onStatus} onOpenShell={onOpenShell} />)
    expect(screen.getByText(/running agent is not captured/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open shell/i }))
    expect(onOpenShell).toHaveBeenCalled()
  })

  it('names the phase while starting', () => {
    render(<CaptureCard {...base} status={{ sandbox: 'demo', state: 'starting', phase: 'tunnel', checks: [] }} />)
    expect(screen.getByText(/opening the tunnel/i)).toBeInTheDocument()
  })

  it('shows the failing phase message and an Enable anyway escape hatch on error', () => {
    const onEnable = vi.fn()
    render(<CaptureCard {...base} onEnable={onEnable}
      status={{ sandbox: 'demo', state: 'error', phase: 'verify', checks: [], message: 'Burp is not chaining back' }} />)
    expect(screen.getByText(/not chaining back/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /enable anyway/i }))
    expect(onEnable).toHaveBeenCalledWith(true)
  })

  it('offers no Enable anyway for a preflight failure — forcing cannot help', () => {
    render(<CaptureCard {...base}
      status={{ sandbox: 'demo', state: 'error', phase: 'preflight', checks: [], message: 'socat is not installed' }} />)
    expect(screen.queryByRole('button', { name: /enable anyway/i })).not.toBeInTheDocument()
  })
})
