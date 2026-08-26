import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InstanceDetail } from '../../src/renderer/screens/InstanceDetail'
import { api } from '../../src/renderer/ipc/client'
import type { InstanceView, DefinitionSpec } from '../../src/shared/types'

const inst: InstanceView = { name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/p', ports: [], definitionId: 'd1', definitionName: 'prj', tier: 'locked', tags: [], createdAt: null }
const base = { onBack: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(), onRebuild: vi.fn(), onApplyCredentials: vi.fn(), onAttach: vi.fn(), onShell: vi.fn(), onSetTags: vi.fn() }

const specWithCustom: DefinitionSpec = {
  definition: { id: 'd1', name: 'P', description: '', agent: 'claude', baseImage: 'img', tier: 'locked', createdAt: 't' },
  mounts: [{ hostPath: '/p', mode: 'direct', isPrimary: true }],
  domains: [], ports: [], hostServices: [],
  credentials: [{ kind: 'custom', id: 'az', label: 'Azure', envVar: 'AZURE_OPENAI_API_KEY', domains: ['x.azure.com'], store: 'encrypted' }]
}
const specNoCreds: DefinitionSpec = { ...specWithCustom, credentials: [] }

afterEach(() => vi.restoreAllMocks())

describe('InstanceDetail', () => {
  it('shows the header, tabs, and switches tabs', () => {
    render(<InstanceDetail instance={inst} {...base} />)
    expect(screen.getByRole('heading', { name: 'sbx-a' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Terminals' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Ports' }))
    expect(screen.getByRole('tab', { name: 'Ports' })).toHaveAttribute('aria-selected', 'true')
  })
  it('Back and Stop/Remove call their handlers', () => {
    const onBack = vi.fn(); const onStop = vi.fn(); const onRemove = vi.fn()
    render(<InstanceDetail instance={inst} {...base} onBack={onBack} onStop={onStop} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i })); expect(onBack).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /stop/i })); expect(onStop).toHaveBeenCalledWith('sbx-a')
    fireEvent.click(screen.getByRole('button', { name: /remove/i })); expect(onRemove).toHaveBeenCalledWith('sbx-a')
  })
  it('Rebuild calls its handler', () => {
    const onRebuild = vi.fn()
    render(<InstanceDetail instance={inst} {...base} onRebuild={onRebuild} />)
    fireEvent.click(screen.getByRole('button', { name: /rebuild/i })); expect(onRebuild).toHaveBeenCalledWith('sbx-a')
  })
  it('disables Stop when not running', () => {
    render(<InstanceDetail instance={{ ...inst, status: 'stopped' }} {...base} />)
    expect(screen.getByRole('button', { name: /stop/i })).toBeDisabled()
  })
  it('shows "Apply live" on the drift notice and calls onApplyCredentials', async () => {
    const onApplyCredentials = vi.fn()
    const onRebuild = vi.fn()
    render(<InstanceDetail
      instance={{ name: 'sbx-1', status: 'running', agent: 'claude', ports: [], workspace: '/p', definitionId: 'd1', definitionName: 'P', tier: 'locked', tags: [], credsDrift: true } as never}
      onBack={() => {}} onStop={() => {}} onRemove={() => {}} onRebuild={onRebuild}
      onAttach={() => {}} onShell={() => {}} onApplyCredentials={onApplyCredentials} onSetTags={() => {}}
    />)
    const applyBtn = await screen.findByText('Apply live')
    fireEvent.click(applyBtn)
    expect(onApplyCredentials).toHaveBeenCalledWith('sbx-1')
    // Rebuild remains available as the fallback.
    expect(screen.getAllByText(/Rebuild/).length).toBeGreaterThan(0)
  })
  it('shows a folder-drift notice offering Rebuild when the definition gained a folder', async () => {
    const onRebuild = vi.fn()
    render(<InstanceDetail
      instance={{ name: 'xray-0c6bea75', status: 'running', agent: 'claude', ports: [], workspace: '/p', definitionId: 'd1', definitionName: 'P', tier: 'open', tags: [], mountsDrift: true } as never}
      onBack={() => {}} onStop={() => {}} onRemove={() => {}} onRebuild={onRebuild}
      onAttach={() => {}} onShell={() => {}} onApplyCredentials={() => {}} onSetTags={() => {}}
    />)
    expect(await screen.findByText(/folders no longer match this sandbox/i)).toBeTruthy()
    // Mounts have no live remedy, so the notice must NOT offer "Apply live".
    expect(screen.queryByText('Apply live')).toBeNull()
    fireEvent.click(screen.getAllByText(/Rebuild/)[0])
    expect(onRebuild).toHaveBeenCalledWith('xray-0c6bea75')
  })
  it('shows no folder-drift notice when mounts are in sync', () => {
    render(<InstanceDetail
      instance={{ name: 'sbx-9', status: 'running', agent: 'claude', ports: [], workspace: '/p', definitionId: 'd1', definitionName: 'P', tier: 'open', tags: [], mountsDrift: false } as never}
      onBack={() => {}} onStop={() => {}} onRemove={() => {}} onRebuild={() => {}}
      onAttach={() => {}} onShell={() => {}} onApplyCredentials={() => {}} onSetTags={() => {}}
    />)
    expect(screen.queryByText(/folders no longer match this sandbox/i)).toBeNull()
  })
  it('disables "Apply live" when the instance is stopped', () => {
    render(<InstanceDetail
      instance={{ name: 'sbx-2', status: 'stopped', agent: 'claude', ports: [], workspace: '/p', definitionId: 'd1', definitionName: 'P', tier: 'locked', tags: [], credsDrift: true } as never}
      onBack={() => {}} onStop={() => {}} onRemove={() => {}} onRebuild={() => {}}
      onAttach={() => {}} onShell={() => {}} onApplyCredentials={() => {}} onSetTags={() => {}}
    />)
    expect(screen.getByText('Apply live')).toBeDisabled()
  })
  it('shows a header "Apply live" for a running, definition-linked instance with credentials (no drift)', async () => {
    vi.spyOn(api, 'defGetSpec').mockResolvedValue({ ok: true, data: specWithCustom })
    const onApplyCredentials = vi.fn()
    render(<InstanceDetail instance={inst} {...base} onApplyCredentials={onApplyCredentials} />)
    const applyBtn = await screen.findByText('Apply live')
    fireEvent.click(applyBtn)
    expect(onApplyCredentials).toHaveBeenCalledWith('sbx-a')
  })
  it('does not show "Apply live" when the linked definition has no service/custom credentials', async () => {
    vi.spyOn(api, 'defGetSpec').mockResolvedValue({ ok: true, data: specNoCreds })
    render(<InstanceDetail instance={inst} {...base} />)
    // give the spec fetch a tick to resolve, then assert the button is absent
    await screen.findByRole('heading', { name: 'sbx-a' })
    expect(screen.queryByText('Apply live')).toBeNull()
  })
})
