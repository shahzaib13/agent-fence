import type { ChatOption, ChecklistData } from '../services/fencingChat'
import { ChecklistRows } from './ChecklistRows'

export function ConfirmationCard({
  message,
  checklist,
  options,
  onSelectOption,
}: {
  message: string
  checklist: ChecklistData
  options: ChatOption[]
  onSelectOption: (option: ChatOption) => void
}) {
  return (
    <div className="rounded-4xl border-2 border-[#062D27]/15 bg-white p-10 shadow-[0_8px_30px_rgba(0,0,0,0.04)] sm:p-12">
      <p className="mb-6 text-2xl leading-snug font-semibold text-[#062D27]">{message}</p>
      <div className="mb-8 rounded-2xl bg-[#F1F4F3] p-6">
        <ChecklistRows checklist={checklist} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {options.map((option) => {
          const isYes = String(option.value) === 'yes'
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onSelectOption(option)}
              className={`rounded-2xl border-2 px-4 py-4 text-sm font-semibold transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27] ${
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
    </div>
  )
}
