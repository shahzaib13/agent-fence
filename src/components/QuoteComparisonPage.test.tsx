import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComparisonSummary } from '../services/fencingChat'
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

describe('QuoteComparisonPage', () => {
  it('renders the header, headline, and stat cards from the comparison summary', () => {
    render(<QuoteComparisonPage comparison={baseComparison} onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: /quote direct comparison/i })).toBeInTheDocument()
    expect(screen.getByText('Aura')).toBeInTheDocument()
    expect(screen.getByText('$1,900')).toBeInTheDocument()
    expect(screen.getByText('$9,100')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('marks the BEST_VALUE quote and shows its savings, but marks a no-savings quote as at local average', () => {
    render(<QuoteComparisonPage comparison={baseComparison} onBack={vi.fn()} />)

    expect(screen.getByText(/best value choice/i)).toBeInTheDocument()
    expect(screen.getByText('Saves $1,900 from avg.')).toBeInTheDocument()
    expect(screen.getByText('Saves $1,250 from avg.')).toBeInTheDocument()
    expect(screen.getByText('At local average')).toBeInTheDocument()
  })

  it('shows a fallback message when there are no comparable quotes', () => {
    render(<QuoteComparisonPage comparison={{ ...baseComparison, quotes: [] }} onBack={vi.fn()} />)

    expect(screen.getByText(/no comparable quotes found yet/i)).toBeInTheDocument()
  })

  it('calls onBack when the back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<QuoteComparisonPage comparison={baseComparison} onBack={onBack} />)

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
