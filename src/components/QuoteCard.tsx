import type { ComparisonQuote } from '../services/fencingChat'

// One ranked business. Lives on its own because two places render it now: the results page
// and the Instant Quote modal. The business name stays hidden in both — the client only
// learns who they picked once the lead is filed and they land on the partner site.
export function QuoteCard({ quote }: { quote: ComparisonQuote }) {
  const isBestValue = quote.tag === 'BEST_VALUE'
  const hasSavings = quote.savingsFromAverage != null && quote.savingsFromAverage > 0
  const savingsLabel = hasSavings ? `Saves $${quote.savingsFromAverage!.toLocaleString()} from avg.` : 'At local average'

  return (
    <div
      className={`relative rounded-3xl bg-white p-5 sm:p-8 ${
        isBestValue
          ? 'border-2 border-[#10B981] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.1)]'
          : `border border-[#F3F4F6] shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${hasSavings ? '' : 'opacity-90 saturate-50'}`
      }`}
    >
      {isBestValue && (
        <span className="absolute -top-3 left-5 rounded-full bg-[#059669] px-4 py-1 text-xs font-bold tracking-[1.2px] text-white uppercase shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)] sm:left-8">
          Best Value Choice
        </span>
      )}

      {/* Below sm the total drops under the business name — side by side, a long name wraps
          to three lines against a price it can't shrink past. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Who the business is stays hidden until the client commits — everything they'd
              actually compare on is still in the clear. Cosmetic only: the name is in the
              payload and the DOM, so this hides it from readers, not from anyone looking. */}
          <p
            aria-hidden="true"
            className={`blur-[6px] text-xl leading-7 select-none text-[#062D27] sm:text-2xl sm:leading-8 ${
              isBestValue ? 'font-bold' : 'font-semibold'
            }`}
          >
            {quote.businessName}
          </p>
          <span className="sr-only">Business name hidden</span>
          <p className="text-base leading-6 text-[#6B7280]">${quote.ratePerMeter}/m rate</p>
          {quote.badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 pt-1 sm:gap-4">
              {quote.badges.map((badge) => (
                <span
                  key={badge}
                  className={`flex items-center gap-1.5 text-sm font-medium ${
                    isBestValue ? 'text-[#047857]' : 'text-[#062D27]'
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={isBestValue ? '#047857' : '#9CA3AF'}
                    strokeWidth={2.5}
                    className="h-4 w-4 shrink-0"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 text-left sm:min-w-60 sm:items-end sm:text-right">
          <p className="text-sm font-medium text-[#6B7280]">Project Total</p>
          <p className={`font-bold text-[#062D27] ${isBestValue ? 'text-3xl leading-9 sm:text-4xl sm:leading-10' : 'text-2xl leading-8 sm:text-3xl sm:leading-9'}`}>
            {quote.projectTotalMin === quote.projectTotalMax
              ? `$${quote.projectTotalMin.toLocaleString()}`
              : `$${quote.projectTotalMin.toLocaleString()} - $${quote.projectTotalMax.toLocaleString()}`}
          </p>
          <p className={isBestValue ? 'text-sm font-bold text-[#059669]' : 'text-sm text-[#6B7280]'}>{savingsLabel}</p>
        </div>
      </div>
    </div>
  )
}
