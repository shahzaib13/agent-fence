import type { AnswerSource } from '../services/fencingChat'
import { budgetSources } from '../services/fencingChat'

function CheckBadge() {
  return (
    <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#062D27] animate-[pop-in_0.35s_ease-out]">
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} className="h-2.5 w-2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  )
}

export function BudgetChips({
  sources,
  picked,
  disabled,
  onSelect,
}: {
  sources: AnswerSource[]
  picked?: AnswerSource
  disabled?: boolean
  onSelect: (source: AnswerSource) => void
}) {
  const chips = budgetSources(sources)
  if (chips.length === 0 && !picked) return null

  if (picked) {
    return (
      <span className="inline-flex items-center gap-2.5 rounded-2xl border border-[#062D27] bg-[#EFF6F5] px-4 py-2.5 animate-[pop-in_0.35s_ease-out]">
        <CheckBadge />
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] font-medium tracking-wide text-[#062D27]/60">Closest to your budget</span>
          <span className="text-sm font-semibold text-[#062D27]">
            {picked.name}
            <span className="font-medium text-[#062D27]/70"> — {picked.figure}</span>
          </span>
        </span>
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 animate-[card-rise_0.45s_ease-out_backwards]">
      <p className="text-xs font-medium tracking-wide text-gray-400">Which of these is closest to your budget?</p>
      <div className="flex flex-wrap">
        {chips.map((source) => (
          <button
            key={source.budgetValue}
            type="button"
            disabled={disabled}
            aria-label={`${source.name}, ${source.figure}`}
            onClick={() => onSelect(source)}
            className="relative mr-2.5 mb-2.5 max-w-64 overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-[#062D27]/40 hover:shadow-[0_6px_20px_rgba(6,45,39,0.08)] active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            <span className="block text-sm font-semibold text-[#062D27]">{source.name}</span>
            <span className="mt-0.5 block text-xs leading-snug text-gray-500">{source.figure}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
