import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InstanceDetail } from '../../../src/renderer/screens/InstanceDetail'
import type { InstanceView } from '@shared/types'

const instance: InstanceView = { name: 'proj-a1', status: 'running', agent: 'claude', workspace: null, ports: [], definitionId: 'd1', definitionName: 'Proj', tier: 'open', tags: ['prod'] }

function noop(): void {}

describe('InstanceDetail tags editor', () => {
  it('calls onSetTags when a tag is added', () => {
    const onSetTags = vi.fn()
    render(
      <InstanceDetail
        instance={instance} hasVSCode={false}
        onBack={noop} onStop={noop} onRemove={noop} onRebuild={noop}
        onApplyCredentials={noop} onAttach={noop} onShell={noop} onSetTags={onSetTags}
      />
    )
    const tagInput = screen.getByLabelText('Edit instance tags')
    fireEvent.change(tagInput, { target: { value: 'eu' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    expect(onSetTags).toHaveBeenCalledWith('proj-a1', ['prod', 'eu'])
  })
})
