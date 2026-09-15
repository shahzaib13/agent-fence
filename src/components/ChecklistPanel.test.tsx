import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChecklistPanel } from './ChecklistPanel'

describe('ChecklistPanel', () => {
  it('draws a retaining wall brief from checklistDisplay and checklistPending', () => {
    render(
      <ChecklistPanel
        checklistDisplay={{
          suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
          wallType: { title: 'Wall type', value: 'Concrete sleepers' },
        }}
        checklistPending={[
          { key: 'supply', title: 'Who supplies' },
          { key: 'lengthMeters', title: 'Length' },
          { key: 'heightKey', title: 'Height' },
          { key: 'removal', title: 'Old wall' },
          { key: 'drainage', title: 'Drainage' },
          { key: 'conditions', title: 'Site' },
        ]}
      />,
    )

    expect(screen.getByText('Suburb: Berwick, VIC 3806')).toBeInTheDocument()
    expect(screen.getByText('Wall type: Concrete sleepers')).toBeInTheDocument()
    expect(screen.getByText('Who supplies')).toBeInTheDocument()
    expect(screen.getByText('Drainage')).toBeInTheDocument()
    expect(screen.queryByText(/^Material$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^wallType$/)).not.toBeInTheDocument()
  })

  it('draws a decking brief from checklistDisplay and checklistPending', () => {
    render(
      <ChecklistPanel
        checklistDisplay={{
          suburb: { title: 'Suburb', value: 'Berwick, VIC 3806' },
          deckHeight: { title: 'Height', value: 'Up high — needs stairs' },
          material: { title: 'Decking', value: 'Merbau' },
        }}
        checklistPending={[
          { key: 'areaSqm', title: 'Size' },
          { key: 'attachment', title: 'Attachment' },
          { key: 'removal', title: 'Old deck' },
          { key: 'balustrade', title: 'Balustrade' },
          { key: 'stairs', title: 'Stairs' },
          { key: 'conditions', title: 'Site' },
        ]}
      />,
    )

    expect(screen.getByText('Suburb: Berwick, VIC 3806')).toBeInTheDocument()
    expect(screen.getByText('Height: Up high — needs stairs')).toBeInTheDocument()
    expect(screen.getByText('Decking: Merbau')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
    expect(screen.getByText('Old deck')).toBeInTheDocument()
    expect(screen.queryByText(/how many metres/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/balustrade length/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^fenceType$/i)).not.toBeInTheDocument()
  })

  it('prefers ordered checklistAnswered rows over the display object', () => {
    render(
      <ChecklistPanel
        checklistAnswered={[{ key: 'suburb', title: 'Suburb', value: 'Pakenham' }]}
        checklistDisplay={{ suburb: { title: 'Suburb', value: 'Berwick' } }}
        checklistPending={[{ key: 'supply', title: 'Who supplies' }]}
      />,
    )

    expect(screen.getByText('Suburb: Pakenham')).toBeInTheDocument()
    expect(screen.queryByText('Suburb: Berwick')).not.toBeInTheDocument()
    expect(screen.getByText('Who supplies')).toBeInTheDocument()
  })

  it('draws a home renovation brief without inventing quantity or a skipped removal row', () => {
    render(
      <ChecklistPanel
        checklistDisplay={{
          suburb: { title: 'Suburb', value: 'Berwick' },
          room: { title: 'Room', value: 'Bathroom' },
          jobType: { title: 'Job', value: 'Just strip it out' },
        }}
        checklistPending={[
          { key: 'extras', title: 'Extras' },
          { key: 'conditions', title: 'Site' },
        ]}
      />,
    )

    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
    expect(screen.getByText('Room: Bathroom')).toBeInTheDocument()
    expect(screen.getByText('Job: Just strip it out')).toBeInTheDocument()
    expect(screen.getByText('Extras')).toBeInTheDocument()
    expect(screen.queryByText(/^Removal$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Length$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Size$/)).not.toBeInTheDocument()
  })
})
