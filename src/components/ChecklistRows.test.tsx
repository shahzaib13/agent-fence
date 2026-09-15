import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChecklistDisplayRows, ChecklistRows } from './ChecklistRows'

describe('ChecklistRows', () => {
  it('does not invent titles from field names when the server did not send any', () => {
    render(<ChecklistRows checklist={{ suburb: 'Berwick', fenceType: null, kitchenSize: 'medium' }} />)

    expect(screen.queryByText('Suburb: Berwick')).not.toBeInTheDocument()
    expect(screen.queryByText('Fence type')).not.toBeInTheDocument()
    expect(screen.queryByText(/kitchenSize/i)).not.toBeInTheDocument()
  })

  it('never renders _ui rows', () => {
    render(<ChecklistRows checklist={{ suburb: 'Berwick', fenceType: null, _ui: { page: 1 } }} />)

    expect(screen.queryByText('_ui')).not.toBeInTheDocument()
  })

  it('renders kitchen brief rows from the response, without fencing field names', () => {
    render(
      <ChecklistDisplayRows
        display={{
          suburb: { title: 'Suburb', value: 'Berwick' },
          jobType: { title: 'Job', value: 'New kitchen' },
          kitchenSize: { title: 'Kitchen size', value: 'Medium' },
          benchtop: { title: 'Benchtop', value: 'Caesarstone' },
        }}
      />,
    )

    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
    expect(screen.getByText('Job: New kitchen')).toBeInTheDocument()
    expect(screen.getByText('Kitchen size: Medium')).toBeInTheDocument()
    expect(screen.getByText('Benchtop: Caesarstone')).toBeInTheDocument()
    expect(screen.queryByText(/material/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/length/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/height/i)).not.toBeInTheDocument()
  })

  it('renders backend-authored checklistDisplay titles and values', () => {
    render(
      <ChecklistDisplayRows
        display={{
          suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
          material: { title: 'Material', value: 'Colorbond' },
          _ui: { title: '_ui', value: 'hidden' },
        }}
      />,
    )

    expect(screen.getByText('Suburb: Berwick, VIC 3806')).toBeInTheDocument()
    expect(screen.getByText('Material: Colorbond')).toBeInTheDocument()
    expect(screen.queryByText('_ui')).not.toBeInTheDocument()
  })

  it('renders a retaining wall brief from server titles, not fencing field names', () => {
    render(
      <ChecklistDisplayRows
        display={{
          suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
          wallType: { title: 'Wall type', value: 'Concrete sleepers' },
          supply: { title: 'Who supplies', value: 'They supply the materials' },
        }}
      />,
    )

    expect(screen.getByText('Suburb: Berwick, VIC 3806')).toBeInTheDocument()
    expect(screen.getByText('Wall type: Concrete sleepers')).toBeInTheDocument()
    expect(screen.getByText('Who supplies: They supply the materials')).toBeInTheDocument()
    expect(screen.queryByText(/^Material$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^wallType$/)).not.toBeInTheDocument()
  })

  it('renders a decking brief from server titles, including material as the board', () => {
    render(
      <ChecklistDisplayRows
        display={{
          suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
          deckHeight: { title: 'Height', value: 'Up high — needs stairs' },
          material: { title: 'Decking', value: 'Merbau' },
        }}
      />,
    )

    expect(screen.getByText('Suburb: Berwick, VIC 3806')).toBeInTheDocument()
    expect(screen.getByText('Height: Up high — needs stairs')).toBeInTheDocument()
    expect(screen.getByText('Decking: Merbau')).toBeInTheDocument()
    expect(screen.queryByText(/^fenceType$/i)).not.toBeInTheDocument()
  })

  it('does not show a pending balustrade-length row when no balustrade was chosen', () => {
    render(
      <ChecklistRows
        checklist={{
          suburb: 'Berwick',
          balustrade: 'none',
          balustradeLm: null,
          stairs: 'none',
          stairFlights: null,
        }}
      />,
    )

    expect(screen.queryByText(/balustrade length/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/stair flights/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^balustradeLm$/)).not.toBeInTheDocument()
  })

  it('does not print a pending field name when the server sent no title', () => {
    render(<ChecklistRows checklist={{ suburb: 'Berwick', fenceType: null }} />)

    expect(screen.queryByText('Fence type')).not.toBeInTheDocument()
    expect(screen.queryByText(/^fenceType$/)).not.toBeInTheDocument()
  })
})
