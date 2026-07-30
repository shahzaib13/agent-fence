import type { WorkerMatch } from '../services/fencingChat'

// Decorative only — n8n only sends {businessName, ratePerMeter, estimatedTotal, notes}, so match%,
// distance, availability and delivery below are static placeholders, not real per-business data.
const RESULT_CARD_DETAILS = [
  {
    matchPercent: 98,
    topRated: true,
    suburb: 'Balmain',
    distanceKm: 2.4,
    availability: 'Available Next Week',
    availabilityHighlight: true,
    delivery: '2-3 Business Days',
  },
  {
    matchPercent: 92,
    topRated: false,
    suburb: 'Rozelle',
    distanceKm: 3.1,
    availability: 'Starts July 14',
    availabilityHighlight: false,
    delivery: 'Next Day',
  },
  {
    matchPercent: 89,
    topRated: false,
    suburb: 'Drummoyne',
    distanceKm: 5.8,
    availability: 'Limited slots',
    availabilityHighlight: false,
    delivery: '5-7 Business Days',
  },
]

export function ResultsPanel({
  results,
  avgRatePerMeter,
  onRestart,
}: {
  results: WorkerMatch[]
  avgRatePerMeter: number | null
  onRestart: () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold tracking-wide text-emerald-600 uppercase">
          {results.length} Recommended Matches
        </p>
        <p className="text-sm text-gray-500">
          Sorting by Match Score{avgRatePerMeter != null ? ` · avg $${avgRatePerMeter}/m` : ''}
        </p>
      </div>

      {results.length === 0 ? (
        <p className="rounded-3xl border border-gray-100 bg-white p-6 text-sm text-gray-500 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
          No matches yet for that suburb and fence type — try a nearby suburb or a different fence type.
        </p>
      ) : (
        results.map((r, i) => {
          const details = RESULT_CARD_DETAILS[i % RESULT_CARD_DETAILS.length]
          return (
            <div
              key={r.businessName}
              className="relative rounded-3xl border border-gray-100 bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)]"
            >
              <span className="absolute -top-3 right-6 flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                ★ {details.matchPercent}% Match
              </span>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7">
                      <rect x="4" y="3" width="16" height="18" rx="1" />
                      <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" />
                    </svg>
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xl font-bold text-[#062D27]">{r.businessName}</p>
                      {details.topRated && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-600">
                          TOP RATED
                        </span>
                      )}
                    </div>
                    <p className="text-gray-500">
                      {details.suburb} — {details.distanceKm}km away
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className={
                    i === 0
                      ? 'rounded-full bg-[#062D27] px-6 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]'
                      : 'rounded-full border border-gray-200 px-6 py-2.5 text-sm font-medium text-[#062D27] transition-all duration-150 hover:border-gray-300 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]'
                  }
                >
                  View Quote
                </button>
              </div>

              <div className="mt-5 flex items-center gap-10">
                <div>
                  <p className="text-[11px] font-bold tracking-wide text-gray-400 uppercase">Availability</p>
                  <p
                    className={`font-semibold ${details.availabilityHighlight ? 'text-emerald-600' : 'text-[#062D27]'}`}
                  >
                    {details.availability}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-bold tracking-wide text-gray-400 uppercase">Est. Delivery</p>
                  <p className="font-semibold text-[#062D27]">{details.delivery}</p>
                </div>
              </div>
            </div>
          )
        })
      )}

      <button
        type="button"
        className="self-center text-sm font-medium text-gray-600 underline underline-offset-2 hover:text-gray-800"
      >
        Show more local businesses
      </button>

      <button
        type="button"
        onClick={onRestart}
        className="self-start rounded-full bg-[#062D27] px-5 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
      >
        Start a new quote
      </button>
    </div>
  )
}
