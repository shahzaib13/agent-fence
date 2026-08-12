import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThinkingScreen } from './ThinkingScreen'

const fullChecklist = {
  suburb: 'Berwick',
  fenceType: 'Colorbond',
  lengthMeters: 20,
  heightMm: 1800,
  removeOldFence: false,
  siteAccess: 'easy',
}

describe('ThinkingScreen', () => {
  it('shows the first card active and personalised when no checklist is known yet', () => {
    render(<ThinkingScreen description="A colorbond fence in Berwick" />)

    expect(screen.getByText(/Reading "A colorbond fence in Berwick"/)).toBeInTheDocument()
  })

  it('expands the checklist inside the second card while fields are still missing', () => {
    render(
      <ThinkingScreen
        description=""
        checklist={{ ...fullChecklist, heightMm: null }}
        checklistComplete={false}
        trade="fencing"
      />,
    )

    expect(screen.getByText('Gathering your fencing details')).toBeInTheDocument()
    expect(screen.getByText('Suburb: Berwick')).toBeInTheDocument()
  })

  it('names the thinking copy after the job they asked for, not fencing', () => {
    render(
      <ThinkingScreen
        description=""
        checklist={{ ...fullChecklist, heightMm: null }}
        checklistComplete={false}
        trade="retaining-wall"
      />,
    )

    expect(screen.getByText('Gathering your retaining wall details')).toBeInTheDocument()
    expect(screen.queryByText('Gathering your fencing details')).not.toBeInTheDocument()
  })

  it('shows "Confirming your details" once every field is known but not yet confirmed', () => {
    render(<ThinkingScreen description="" checklist={fullChecklist} checklistComplete={false} />)

    expect(screen.getByText('Confirming your details')).toBeInTheDocument()
  })

  it('shows the new-quote finishing card once awaiting the final result', async () => {
    render(
      <ThinkingScreen
        description=""
        checklist={fullChecklist}
        checklistComplete
        awaitingResult
        intent="new_quote"
        selectedType="Deck"
      />,
    )

    // The reveal replays from card 0 rather than jumping straight there — real progress, not a snap.
    expect(screen.getByRole('heading', { name: 'Analysing your project' })).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Finalising your quote' })).toBeInTheDocument())
    expect(screen.getByText('Finding your best local matches')).toBeInTheDocument()
    expect(screen.getByText("We're matching you with the best local decking businesses.")).toBeInTheDocument()
  })

  it('shows the comparison-specific finishing card for the compare_quote intent', async () => {
    render(<ThinkingScreen description="" checklist={fullChecklist} checklistComplete awaitingResult intent="compare_quote" />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Comparing your quote' })).toBeInTheDocument())
    expect(screen.getByText('Comparing your quote against the market')).toBeInTheDocument()
  })
})
