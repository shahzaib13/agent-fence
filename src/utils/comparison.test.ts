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
    expect(summary.quotes[2].notes).toBe('Premium finish')
  })

  it('stamps a response-level unit onto matches that did not carry their own', () => {
    const summary = workerMatchesToComparison(
      [{ businessName: 'Paky Tiles', suburb: 'Berwick', ratePerMeter: 72, estimatedTotal: 1440, notes: '' }],
      'm2',
    )
    expect(summary.quotes[0].unit).toBe('m2')
  })

  it('keeps the server total for a decking match, not rate times area', () => {
    const summary = workerMatchesToComparison(
      [
        {
          businessName: 'Berwick Decks',
          suburb: 'Berwick',
          ratePerMeter: 625,
          estimatedTotal: 19815,
          notes: 'incl. GST · 12m of balustrade included · Stairs included',
        },
      ],
      'm2',
    )

    expect(summary.quotes[0]).toMatchObject({
      ratePerMeter: 625,
      projectTotalMin: 19815,
      projectTotalMax: 19815,
      unit: 'm2',
      notes: 'incl. GST · 12m of balustrade included · Stairs included',
    })
  })

  it('keeps a kitchen whole-job figure off the per-metre line by carrying notes and unit', () => {
    const summary = workerMatchesToComparison([
      {
        businessName: 'Berwick Kitchens',
        suburb: 'Berwick',
        ratePerMeter: 15470,
        estimatedTotal: 15470,
        notes: '2-pack, 3.2m run',
        unit: 'item',
      },
    ])

    expect(summary.quotes[0]).toMatchObject({
      ratePerMeter: 15470,
      projectTotalMin: 15470,
      projectTotalMax: 15470,
      unit: 'item',
      notes: '2-pack, 3.2m run',
    })
  })

  it('keeps match-level badges instead of collapsing them into suburb plus notes', () => {
    const summary = workerMatchesToComparison(
      [
        {
          businessName: 'Berwick Renovations',
          suburb: 'Berwick',
          ratePerMeter: 18400,
          estimatedTotal: 18400,
          notes: '',
          unit: 'item',
          badges: [
            'Floor tiling measured on site, not in this price',
            'Carpentry charged by the hour on site, not in this price',
          ],
        },
      ],
      'item',
    )

    expect(summary.quotes[0].unit).toBe('item')
    expect(summary.quotes[0].badges).toEqual([
      'Floor tiling measured on site, not in this price',
      'Carpentry charged by the hour on site, not in this price',
    ])
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
