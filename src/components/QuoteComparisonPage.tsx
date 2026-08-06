import { useState } from 'react'
import type { ComparisonSummary } from '../services/fencingChat'
import { Header } from './Header'
import type { SuburbPlace } from '../services/places'
import { InstantQuoteFlow } from './InstantQuoteFlow'
import { QuoteCard } from './QuoteCard'

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

export function QuoteComparisonPage({
  comparison,
  intent,
  place,
  onBack,
}: {
  comparison: ComparisonSummary
  // Carried through from the conversation rather than re-derived here: the saved job records
  // the whole place, and this page is the last screen before it is written.
  place?: SuburbPlace | null
  // Both flows end here — only the headline says which one you came through. Absent (an older
  // workflow that never reports an intent) reads as a fresh quote, since the compare branch
  // can't fire without n8n declaring `compare_quote` in the first place.
  intent?: 'new_quote' | 'compare_quote'
  onBack: () => void
}) {
  const [isInstantQuoteOpen, setIsInstantQuoteOpen] = useState(false)

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
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-[-1.12px] text-[#062D27] sm:text-[56px]">
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

        {comparison.quotes.length > 0 && (
          <div className="mb-5 flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xs font-bold tracking-[0.6px] text-[#6B7280] uppercase">Your matched partners</h2>
            <button
              type="button"
              onClick={() => setIsInstantQuoteOpen(true)}
              className="rounded-full bg-[#062D27] px-6 py-3 text-sm font-semibold text-white transition-all duration-150 hover:scale-[1.02] hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              Instant Quote
            </button>
          </div>
        )}

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

      {/* Mounted only while open, so closing it drops straight back to this page with its
          state untouched — no route change, no refetch. */}
      {isInstantQuoteOpen && (
        <InstantQuoteFlow
          quotes={comparison.quotes}
          place={place ?? null}
          onClose={() => setIsInstantQuoteOpen(false)}
        />
      )}
    </div>
  )
}
