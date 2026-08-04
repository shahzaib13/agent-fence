import type { ChatOption, ChecklistData } from '../services/fencingChat'
import { ChecklistRows } from './ChecklistRows'

// The recap-and-confirm turn, rendered inside the chat thread. The workflow's recap sentence
// is already in the message bubble above it, so this card is only the brief itself plus the
// yes/no choice — and once that choice is made it collapses to the answer, same as an MCQ row.
export function ConfirmationCard({
  checklist,
  options,
  answered,
  disabled,
  onSelectOption,
}: {
  checklist: ChecklistData
  options: ChatOption[]
  answered?: ChatOption
  disabled?: boolean
  onSelectOption: (option: ChatOption) => void
}) {
  return (
    <div className="max-w-2xl rounded-3xl border border-[#062D27]/15 bg-white p-6 shadow-[0_10px_40px_rgba(6,45,39,0.07)] animate-[card-rise_0.45s_ease-out_backwards]">
      <p className="mb-5 text-[11px] font-bold tracking-widest text-emerald-600 uppercase">Your project brief</p>
      <div className="mb-6 rounded-2xl bg-[#F1F4F3] p-5">
        <ChecklistRows checklist={checklist} />
      </div>

      {answered ? (
        <span className="inline-flex items-center gap-2.5 rounded-2xl border border-[#062D27] bg-[#EFF6F5] px-4 py-2.5 text-sm font-semibold text-[#062D27] animate-[pop-in_0.35s_ease-out]">
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#062D27]">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} className="h-2.5 w-2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
          {answered.label}
        </span>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {options.map((option) => {
            const isYes = String(option.value) === 'yes'
            return (
              <button
                key={String(option.value)}
                type="button"
                disabled={disabled}
                onClick={() => onSelectOption(option)}
                className={`rounded-2xl border px-4 py-3.5 text-sm font-semibold transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27] ${
                  isYes
                    ? 'border-[#062D27] bg-[#062D27] text-white hover:bg-[#0a3f37]'
                    : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
