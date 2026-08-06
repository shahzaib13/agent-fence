import type { ComparisonSummary, WorkerMatch } from '../services/fencingChat'

// Both intents land on the comparison page now, but the new-quote flow returns plain matches
// rather than the compare flow's ranked quote objects. The page-level figures it expects are
// derived from the matches themselves: the "market average" is what these businesses average
// out to, and each one's saving is measured against that. There is no user-supplied price to
// beat in this flow, hence `userExistingPrice: null`.
export function workerMatchesToComparison(results: WorkerMatch[]): ComparisonSummary {
  const totals = results.map((r) => r.estimatedTotal)
  const marketAverage = totals.length > 0 ? Math.round(totals.reduce((sum, t) => sum + t, 0) / totals.length) : null
  // Only ever a *saving* — a match priced above the average has none, and the card says so.
  const savingsFrom = (total: number) => (marketAverage != null && marketAverage > total ? marketAverage - total : null)

  return {
    potentialSavings: totals.length > 0 ? savingsFrom(Math.min(...totals)) : null,
    marketAverage,
    totalQuotesScreened: results.length,
    userExistingPrice: null,
    quotes: [...results]
      .sort((a, b) => a.estimatedTotal - b.estimatedTotal)
      .map((r, index) => ({
        businessId: r.businessId,
        autoAcceptsAi: r.autoAcceptsAi,
        businessName: r.businessName,
        ratePerMeter: r.ratePerMeter,
        // A single estimate, not a range — the card renders one figure when both ends match.
        projectTotalMin: r.estimatedTotal,
        projectTotalMax: r.estimatedTotal,
        badges: [...(r.suburb ? [`Services ${r.suburb}`] : []), ...(r.notes ? [r.notes] : [])],
        tag: index === 0 ? 'BEST_VALUE' : null,
        savingsFromAverage: savingsFrom(r.estimatedTotal),
      })),
  }
}
