import { describe, expect, it } from 'vitest'
import type { WorkerMatch } from '../services/fencingChat'
import { workerMatchesToComparison } from './comparison'

const matches: WorkerMatch[] = [
  { businessName: 'Pricey Fencing', suburb: 'Berwick', ratePerMeter: 200, estimatedTotal: 4000, notes: 'Premium finish' },
  { businessName: 'A Plus Fencing', suburb: 'Berwick', ratePerMeter: 100, estimatedTotal: 2000, notes: '' },
  { businessName: 'Mid Fencing', suburb: 'Berwick', ratePerMeter: 150, estimatedTotal: 3000, notes: '' },
]

describe('workerMatchesToComparison', () => {
  it('ranks the cheapest match first and measures every saving against the average of them all', () => {
    const summary = workerMatchesToComparison(matches)

    expect(summary.marketAverage).toBe(3000)
    expect(summary.potentialSavings).toBe(1000)
    expect(summary.totalQuotesScreened).toBe(3)
    // Nothing to beat in the new-quote flow — the page must not claim the user had a price.
    expect(summary.userExistingPrice).toBeNull()
    expect(summary.quotes.map((q) => q.businessName)).toEqual(['A Plus Fencing', 'Mid Fencing', 'Pricey Fencing'])
    expect(summary.quotes[0].tag).toBe('BEST_VALUE')
    expect(summary.quotes[0].savingsFromAverage).toBe(1000)
    // At and above the average there is no saving to advertise — the card says "at local average".
    expect(summary.quotes[1].savingsFromAverage).toBeNull()
    expect(summary.quotes[2].savingsFromAverage).toBeNull()
  })

  it('carries the suburb and any notes across as badges, skipping the ones with nothing to say', () => {
    const summary = workerMatchesToComparison(matches)

    expect(summary.quotes[0].badges).toEqual(['Services Berwick'])
    expect(summary.quotes[2].badges).toEqual(['Services Berwick', 'Premium finish'])
  })

  it('renders a lone match as its own best value with no savings claim', () => {
    const summary = workerMatchesToComparison([matches[1]])

    expect(summary.marketAverage).toBe(2000)
    expect(summary.potentialSavings).toBeNull()
    expect(summary.quotes[0].tag).toBe('BEST_VALUE')
    expect(summary.quotes[0].projectTotalMin).toBe(summary.quotes[0].projectTotalMax)
  })

  it('survives an empty match list instead of averaging nothing into NaN', () => {
    const summary = workerMatchesToComparison([])

    expect(summary.marketAverage).toBeNull()
    expect(summary.potentialSavings).toBeNull()
    expect(summary.quotes).toEqual([])
  })
})
