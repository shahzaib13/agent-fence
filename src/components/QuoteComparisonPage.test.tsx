import { render as renderBare, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComparisonSummary } from '../services/fencingChat'
import type { QuoteSession } from '../services/quotes'
import { QuoteComparisonPage } from './QuoteComparisonPage'

const baseComparison: ComparisonSummary = {
  potentialSavings: 1900,
  marketAverage: 9100,
  totalQuotesScreened: 12,
  userExistingPrice: 9100,
  quotes: [
    {
      businessName: 'Modern Decks NSW',
      ratePerMeter: 118,
      projectTotalMin: 7200,
      projectTotalMax: 7600,
      leadTimeWeeksMin: 1,
      leadTimeWeeksMax: 2,
      badges: ['Standard Timber', 'Most Affordable'],
      tag: 'BEST_VALUE',
      savingsFromAverage: 1900,
    },
    {
      businessName: 'Heritage Decking Co.',
      ratePerMeter: 145,
      projectTotalMin: 7850,
      projectTotalMax: 8200,
      leadTimeWeeksMin: 2,
      leadTimeWeeksMax: 3,
      badges: ['Standard Timber'],
      tag: null,
      savingsFromAverage: 1250,
    },
    {
      businessName: 'Coastal Timber Solutions',
      ratePerMeter: 175,
      projectTotalMin: 8400,
      projectTotalMax: 9100,
      leadTimeWeeksMin: 4,
      leadTimeWeeksMax: 6,
      badges: ['Standard Timber'],
      tag: null,
      savingsFromAverage: null,
    },
  ],
}

// Header links need a router context; these pages are always inside one in the app.
const render = (ui: ReactElement) => renderBare(ui, { wrapper: MemoryRouter })

const quoteSession: QuoteSession = {
  sessionId: 'sess-1',
  status: 'complete',
  createdAt: 1_754_000_000_000,
  updatedAt: 1_754_000_100_000,
  messages: [{ id: 'm1', role: 'user', text: 'I need a fence' }],
  checklist: { suburb: 'Pakenham, VIC 3810', fenceType: 'Timber' },
  place: null,
  comparison: null,
}

describe('QuoteComparisonPage', () => {
  it('renders the header, headline, and stat cards from the comparison summary', () => {
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={baseComparison} intent="compare_quote" onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: /quote direct comparison/i })).toBeInTheDocument()
    expect(screen.getByText('Aura')).toBeInTheDocument()
    expect(screen.getByText('$1,900')).toBeInTheDocument()
    expect(screen.getByText('$9,100')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  // The results live at "/" as well, so the logo's Link had nowhere to navigate and clicking it
  // sat on the results page. Same for "New project", which was wired to nothing at all here.
  it('starts over from the logo and from New project, since neither is a route change', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={baseComparison} onBack={onBack} />)

    await user.click(screen.getByText('Aura'))
    expect(onBack).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /new project/i }))
    expect(onBack).toHaveBeenCalledTimes(2)
  })

  it('marks the BEST_VALUE quote and shows its savings, but marks a no-savings quote as at local average', () => {
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={baseComparison} onBack={vi.fn()} />)

    expect(screen.getByText(/best value choice/i)).toBeInTheDocument()
    expect(screen.getByText('Saves $1,900 from avg.')).toBeInTheDocument()
    expect(screen.getByText('Saves $1,250 from avg.')).toBeInTheDocument()
    expect(screen.getByText('At local average')).toBeInTheDocument()
  })

  it('shows a fallback message when there are no comparable quotes', () => {
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={{ ...baseComparison, quotes: [] }} onBack={vi.fn()} />)

    expect(screen.getByText(/no comparable quotes found yet/i)).toBeInTheDocument()
  })

  it('titles the page by intent, so a fresh quote is not called a direct comparison', () => {
    const { rerender } = render(<QuoteComparisonPage quoteSession={quoteSession} comparison={baseComparison} intent="new_quote" onBack={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument()

    rerender(<QuoteComparisonPage quoteSession={quoteSession} comparison={baseComparison} intent="compare_quote" onBack={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /quote direct comparison/i })).toBeInTheDocument()
  })

  it('hides every business name behind a blur and announces it as hidden', () => {
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={baseComparison} onBack={vi.fn()} />)

    const name = screen.getByText('Modern Decks NSW')
    expect(name).toHaveAttribute('aria-hidden', 'true')
    expect(name.className).toMatch(/blur-/)
    expect(screen.getAllByText('Business name hidden')).toHaveLength(3)
    // Everything they'd actually compare on stays readable
    expect(screen.getByText('$118/m rate')).toBeInTheDocument()
  })

  it('shows neither a lead time nor a proceed button', () => {
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={baseComparison} onBack={vi.fn()} />)

    expect(screen.queryByText(/lead time/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /proceed/i })).not.toBeInTheDocument()
  })

  it('collapses a single-figure estimate instead of printing the same number twice', () => {
    const flat = { ...baseComparison.quotes[0], projectTotalMin: 7200, projectTotalMax: 7200 }
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={{ ...baseComparison, quotes: [flat] }} onBack={vi.fn()} />)

    expect(screen.getByText('$7,200')).toBeInTheDocument()
    expect(screen.queryByText('$7,200 - $7,200')).not.toBeInTheDocument()
  })

  it('opens the instant quote dialog with the names revealed, and cancelling returns to the page intact', async () => {
    const user = userEvent.setup()
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={baseComparison} onBack={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /instant quote/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Modern Decks NSW')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Same page, same data — the dialog only ever unmounts on top of it.
    expect(screen.getByRole('heading', { name: /your local quote comparison/i })).toBeInTheDocument()
    expect(screen.getAllByText('Business name hidden')).toHaveLength(3)
  })

  it('offers no instant quote when there is nothing to quote on', () => {
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={{ ...baseComparison, quotes: [] }} onBack={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /instant quote/i })).not.toBeInTheDocument()
  })

  it('calls onBack when the back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<QuoteComparisonPage quoteSession={quoteSession} comparison={baseComparison} onBack={onBack} />)

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
