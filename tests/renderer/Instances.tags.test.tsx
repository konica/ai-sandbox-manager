import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Instances } from '../../src/renderer/screens/Instances'
import type { InstanceView } from '@shared/types'

function inst(name: string, tags: string[]): InstanceView {
  return { name, status: 'running', agent: 'claude', workspace: null, ports: [], definitionId: 'd1', definitionName: 'Proj', tier: 'open', tags, createdAt: null }
}

const data = [inst('proj-prod-1', ['prod']), inst('proj-eu-1', ['eu']), inst('proj-x', [])]

describe('Instances tag filter', () => {
  it('renders each instance tag as a chip', () => {
    render(<Instances instances={data} />)
    expect(screen.getAllByText('prod').length).toBeGreaterThan(0)
  })
  it('filters rows to instances having the selected tag (OR)', () => {
    render(<Instances instances={data} />)
    // The filter bar exposes a toggle per distinct tag.
    fireEvent.click(screen.getByRole('button', { name: 'Filter tag prod' }))
    const table = screen.getByRole('table')
    expect(within(table).queryByText('proj-prod-1')).toBeTruthy()
    expect(within(table).queryByText('proj-eu-1')).toBeNull()
    expect(within(table).queryByText('proj-x')).toBeNull()
  })
})
