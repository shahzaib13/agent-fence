import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChecklistRows } from './ChecklistRows'

describe('ChecklistRows', () => {
  it('shows a checkmark and value for a completed field', () => {
    render(<ChecklistRows checklist={{ suburb: 'Berwick', fenceType: null }} />)

    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
  })

  it('never renders _ui rows', () => {
    render(<ChecklistRows checklist={{ suburb: 'Berwick', fenceType: null, _ui: { page: 1 } }} />)

    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
    expect(screen.queryByText('_ui')).not.toBeInTheDocument()
  })

  it('shows a pending dot with no value for a field not yet known', () => {
    render(<ChecklistRows checklist={{ suburb: 'Berwick', fenceType: null }} />)

    expect(screen.getByText('Fence type')).toBeInTheDocument()
    expect(screen.queryByText(/Fence type:/)).not.toBeInTheDocument()
  })
})
