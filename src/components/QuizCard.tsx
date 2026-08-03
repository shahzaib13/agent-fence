import { useEffect, useState } from 'react'
import type { ChatOption, ChecklistData } from '../services/fencingChat'
import { ChecklistRows } from './ChecklistRows'

// Decorative only — n8n only sends {label, value} for each option, so this maps
// common keywords to a generic icon instead of inventing per-option facts.
const OPTION_ICONS: [string, string][] = [
  ['timber', '🪵'],
  ['colorbond', '🏗️'],
  ['aluminium', '🔩'],
  ['pool', '🏊'],
  ['security', '🔒'],
  ['chainmesh', '🔒'],
  ['rural', '🌾'],
  ['easy', '🙂'],
  ['difficult', '⚠️'],
  ['clear', '🚗'],
  ['side', '🚶'],
  ['steep', '⛰️'],
  ['yes', '✅'],
  ['no', '❌'],
  ['sure', '🤔'],
  ['not sure', '❓'],
  ['asap', '⚡'],
  ['month', '📅'],
]

function getOptionIcon(label: string) {
  const key = label.toLowerCase()
  const match = OPTION_ICONS.find(([keyword]) => key.includes(keyword))
  if (match) return match[1]
  if (/\d/.test(label)) return '📏'
  return '•'
}

// Loading itself is handled one level up by ThinkingScreen (Home.tsx swaps this whole
// component out while a request is in flight) — QuizCard only ever renders once a response
// (a question, or an error) is already on screen.
export function QuizCard({
  questionNumber,
  message,
  options,
  checklist,
  hasError,
  onSend,
  onSelectOption,
  onRetry,
  onBack,
}: {
  questionNumber: number
  message: string
  options: ChatOption[] | null
  checklist?: ChecklistData | null
  hasError: boolean
  onSend: (text: string) => void
  onSelectOption: (option: ChatOption) => void
  onRetry: () => void
  onBack: () => void
}) {
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<ChatOption | null>(null)
  const showOptions = !hasError && !!options && options.length > 0
  const showFreeText = !hasError && (!options || options.length === 0)

  useEffect(() => {
    setSelected(null)
  }, [message])

  return (
      <div className="rounded-4xl border border-gray-100 bg-white p-10 shadow-[0_8px_30px_rgba(0,0,0,0.04)] sm:p-12">
        {!hasError && (
          <p className="mb-2 text-[11px] font-bold tracking-widest text-emerald-600 uppercase">
            Question {questionNumber}
          </p>
        )}
        {checklist && (
          <div className="mb-6 lg:hidden">
            <ChecklistRows checklist={checklist} />
          </div>
        )}
        <p className="mb-8 text-3xl leading-snug font-semibold text-[#062D27]">{message}</p>

        {hasError && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-[#062D27] px-6 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            Try again
          </button>
        )}

        {showOptions && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {options.map((option) => {
              const active = option.value === selected?.value
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => setSelected(option)}
                  aria-pressed={active}
                  className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 px-4 py-7 transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27] ${
                    active ? 'border-[#062D27] bg-[#EFF6F5]' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${active ? 'bg-white' : 'bg-gray-100'}`}
                  >
                    {getOptionIcon(option.label)}
                  </span>
                  <span
                    className={`text-sm font-semibold ${active ? 'text-[#062D27]' : 'text-gray-700'}`}
                  >
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {showFreeText && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!draft.trim()) return
              onSend(draft.trim())
              setDraft('')
            }}
            className="flex items-center gap-3 rounded-full border border-gray-200 bg-white px-3 py-2"
          >
            <label htmlFor="quiz-reply" className="sr-only">
              Your answer
            </label>
            <input
              id="quiz-reply"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your answer..."
              className="flex-1 border-0 bg-transparent px-2 text-sm text-[#062D27] placeholder:text-gray-300 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="rounded-full bg-[#062D27] px-5 py-2 text-sm font-medium text-white transition-all duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              Send
            </button>
          </form>
        )}

        {!hasError && (
          <div className="mt-8 flex items-center justify-between border-t border-gray-100 pt-6">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            {showOptions && (
              <button
                type="button"
                onClick={() => selected && onSelectOption(selected)}
                disabled={!selected}
                className="rounded-full bg-[#062D27] px-6 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
              >
                Continue
              </button>
            )}
          </div>
        )}
      </div>
  )
}
