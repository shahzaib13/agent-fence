import { Header } from './Header'
import type { ComparisonQuote, ComparisonSummary } from '../services/fencingChat'

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub: string
  highlight?: boolean
}) {
  return (
    <div
      className={`flex flex-1 flex-col gap-1 rounded-2xl border p-6 ${
        highlight ? 'border-[#D1FAE5] bg-[#ECFDF5]' : 'border-[#F3F4F6] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
      }`}
    >
      <p className={`text-xs font-bold tracking-[0.6px] uppercase ${highlight ? 'text-[#065F46]' : 'text-[#6B7280]'}`}>
        {label}
      </p>
      <p className={`text-3xl leading-9 font-bold ${highlight ? 'text-[#064E3B]' : 'text-[#062D27]'}`}>{value}</p>
      <p className={`text-sm ${highlight ? 'text-[#047857]' : 'text-[#6B7280]'}`}>{sub}</p>
    </div>
  )
}

function QuoteCard({ quote }: { quote: ComparisonQuote }) {
  const isBestValue = quote.tag === 'BEST_VALUE'
  const hasSavings = quote.savingsFromAverage != null && quote.savingsFromAverage > 0
  const savingsLabel = hasSavings ? `Saves $${quote.savingsFromAverage!.toLocaleString()} from avg.` : 'At local average'

  return (
    <div
      className={`relative rounded-3xl bg-white p-8 ${
        isBestValue
          ? 'border-2 border-[#10B981] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.1)]'
          : `border border-[#F3F4F6] shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${hasSavings ? '' : 'opacity-90 saturate-50'}`
      }`}
    >
      {isBestValue && (
        <span className="absolute -top-3 left-8 rounded-full bg-[#059669] px-4 py-1 text-xs font-bold tracking-[1.2px] text-white uppercase shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)]">
          Best Value Choice
        </span>
      )}

      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Who the business is stays hidden until the client commits — everything they'd
              actually compare on is still in the clear. Cosmetic only: the name is in the
              payload and the DOM, so this hides it from readers, not from anyone looking. */}
          <p
            aria-hidden="true"
            className={`text-2xl leading-8 text-[#062D27] blur-[6px] select-none ${isBestValue ? 'font-bold' : 'font-semibold'}`}
          >
            {quote.businessName}
          </p>
          <span className="sr-only">Business name hidden</span>
          <p className="text-base leading-6 text-[#6B7280]">${quote.ratePerMeter}/m rate</p>
          {quote.badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 pt-1">
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

        <div className="flex min-w-60 flex-col items-end gap-1 text-right">
          <p className="text-sm font-medium text-[#6B7280]">Project Total</p>
          <p
            className={`text-[#062D27] font-bold ${isBestValue ? 'text-4xl leading-10' : 'text-3xl leading-9'}`}
          >
            {quote.projectTotalMin === quote.projectTotalMax
              ? `$${quote.projectTotalMin.toLocaleString()}`
              : `$${quote.projectTotalMin.toLocaleString()} - $${quote.projectTotalMax.toLocaleString()}`}
          </p>
          <p className={isBestValue ? 'text-sm font-bold text-[#059669]' : 'text-sm text-[#6B7280]'}>
            {savingsLabel}
          </p>
        </div>
      </div>
    </div>
  )
}

export function QuoteComparisonPage({
  comparison,
  intent,
  onBack,
}: {
  comparison: ComparisonSummary
  // Both flows end here — only the headline says which one you came through. Absent (an older
  // workflow that never reports an intent) reads as a fresh quote, since the compare branch
  // can't fire without n8n declaring `compare_quote` in the first place.
  intent?: 'new_quote' | 'compare_quote'
  onBack: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
      <Header />

      <main className="mx-auto flex w-full max-w-[1024px] flex-1 flex-col items-center px-4 pt-12 pb-24">
        <button
          type="button"
          onClick={onBack}
          className="mb-6 flex items-center gap-1 self-start rounded-full px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="mb-12 flex max-w-3xl flex-col items-center gap-4 text-center">
          <h1 className="text-[56px] leading-[1.1] font-semibold tracking-[-1.12px] text-[#062D27]">
            {intent === 'compare_quote' ? 'Quote Direct Comparison.' : 'Your Local Quote Comparison.'}
          </h1>
          <p className="text-lg leading-7 text-[#6B7280]">
            We've analyzed your project and found high-value local partners that meet your technical requirements.
          </p>
        </div>

        <div className="mb-12 flex w-full flex-col gap-4 sm:flex-row">
          <StatCard
            label="Potential Savings"
            value={comparison.potentialSavings != null ? `$${comparison.potentialSavings.toLocaleString()}` : '—'}
            sub="vs. market average"
            highlight
          />
          <StatCard
            label="Market Average"
            value={comparison.marketAverage != null ? `$${comparison.marketAverage.toLocaleString()}` : '—'}
            sub="Based on local data"
          />
          <StatCard label="Total Quotes" value={String(comparison.totalQuotesScreened)} sub="Screened for quality" />
        </div>

        <div className="flex w-full flex-col gap-4">
          {comparison.quotes.length === 0 ? (
            <p className="rounded-3xl border border-[#F3F4F6] bg-white p-6 text-sm text-[#6B7280] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              No comparable quotes found yet for that suburb and fence type — try a nearby suburb or a different
              fence type.
            </p>
          ) : (
            comparison.quotes.map((quote) => <QuoteCard key={quote.businessName} quote={quote} />)
          )}
        </div>

        <p className="mt-16 text-sm text-[#6B7280]">
          Price protection and satisfaction guarantee included on all verified quotes.
        </p>
      </main>

      <footer className="flex justify-center py-8">
        <p className="max-w-3xl px-4 text-center text-xs text-[#9CA3AF]">
          Calculations follow AS 2870-2011 Residential slabs and footings. Estimates are indicative until site
          inspection.
        </p>
      </footer>
    </div>
  )
}
