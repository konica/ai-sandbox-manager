import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Instances } from '../../src/renderer/screens/Instances'
import type { InstanceView } from '@shared/types'

const rows: InstanceView[] = [
  { name: 'sbx-a', status: 'running', agent: 'claude', workspace: '/w', ports: ['127.0.0.1:8080->3000/tcp'], definitionId: 'd1', definitionName: 'prj-alpha', tier: 'locked' }
]

describe('Instances screen', () => {
  it('renders a row per instance with its definition and ports', () => {
    render(<Instances instances={rows} />)
    expect(screen.getByText('sbx-a')).toBeInTheDocument()
    expect(screen.getByText('prj-alpha')).toBeInTheDocument()
    expect(screen.getByText('127.0.0.1:8080->3000/tcp')).toBeInTheDocument()
  })

  it('shows the empty state when there are no instances', () => {
    render(<Instances instances={[]} />)
    expect(screen.getByText(/no sandboxes yet/i)).toBeInTheDocument()
  })
})
