import type { AlternativeOffer, ChatOption } from '../services/fencingChat'

function CheckBadge() {
  return (
    <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#062D27]">
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} className="h-2.5 w-2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  )
}

export function AlternativeOffers({
  alternatives,
  options,
  answered,
  disabled,
  onSelect,
}: {
  alternatives: AlternativeOffer[]
  options: ChatOption[]
  answered?: ChatOption
  disabled?: boolean
  onSelect: (option: ChatOption) => void
}) {
  const altValues = new Set(alternatives.map((offer) => offer.value))
  const leftover = options.filter((option) => !altValues.has(String(option.value)))

  if (answered) {
    return (
      <span className="inline-flex items-center gap-2.5 rounded-2xl border border-[#062D27] bg-[#EFF6F5] px-4 py-2.5 animate-[pop-in_0.35s_ease-out]">
        <CheckBadge />
        <span className="text-sm font-semibold text-[#062D27]">{answered.label}</span>
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-3 animate-[card-rise_0.45s_ease-out_backwards]">
      {alternatives.map((offer) => (
        <button
          key={offer.value}
          type="button"
          disabled={disabled}
          onClick={() => onSelect({ label: `${offer.materialLabel}, ${offer.heightKey}`, value: offer.value })}
          className="flex w-full max-w-md items-end justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[#062D27]/40 hover:shadow-[0_6px_20px_rgba(6,45,39,0.08)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-[#062D27]">
              {offer.materialLabel}, {offer.heightKey}
            </span>
            <span aria-hidden="true" className="truncate text-xs text-gray-400 blur-[3px] select-none">
              {offer.businessName}
            </span>
            <span className="sr-only">Business name hidden</span>
          </span>
          <span className="shrink-0 text-lg font-bold text-[#062D27]">
            ${offer.estimatedTotal.toLocaleString()}
          </span>
        </button>
      ))}
      {leftover.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {leftover.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(option)}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-all duration-150 hover:border-[#062D27]/40 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
