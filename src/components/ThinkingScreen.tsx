import type { ChecklistData } from '../services/fencingChat'
import { ChecklistRows } from './ChecklistRows'

type CardState = 'done' | 'active' | 'pending'

function buildFirstCardLabel(description: string) {
  const trimmed = description.trim()
  const excerpt = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed
  return excerpt ? `Reading "${excerpt}"` : 'Reading your project details'
}

// Which of the 4 cards is "active" right now — derived entirely from data the workflow already
// sends on every turn (checklist / checklistComplete), not a fake timer. There's no streaming
// endpoint (single request/response), so this can only reflect what the LAST response told us —
// it can't animate sub-steps mid-request, only jump forward once a new response lands.
function getActiveCardIndex(checklist: ChecklistData | null, checklistComplete: boolean, awaitingResult: boolean) {
  if (awaitingResult) return 3
  if (!checklist) return 0
  if (Object.values(checklist).some((value) => value === null)) return 1
  if (!checklistComplete) return 2
  return 3
}

// What the expanded/active card shows inside itself — the real checklist for the "gathering
// details" card (index 1), a plain "still working" pulse for the others (there's no finer-grained
// real data to show for those, so this stays honest rather than inventing fake sub-steps).
function ActiveCardDetail({ index, checklist }: { index: number; checklist: ChecklistData | null }) {
  if (index === 1 && checklist) {
    return <ChecklistRows checklist={checklist} />
  }
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-300 animate-[dot-pulse_1s_ease-in-out_infinite]" />
      <span className="h-1.5 w-1.5 rounded-full bg-gray-300 animate-[dot-pulse_1s_ease-in-out_infinite_0.15s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-gray-300 animate-[dot-pulse_1s_ease-in-out_infinite_0.3s]" />
      <span>Working on this…</span>
    </div>
  )
}

export function ThinkingScreen({
  description,
  checklist = null,
  checklistComplete = false,
  awaitingResult = false,
  intent,
}: {
  description: string
  checklist?: ChecklistData | null
  checklistComplete?: boolean
  awaitingResult?: boolean
  intent?: 'new_quote' | 'compare_quote'
}) {
  const activeIndex = getActiveCardIndex(checklist, checklistComplete, awaitingResult)
  const isComparing = intent === 'compare_quote'

  const cards = [
    buildFirstCardLabel(description),
    'Gathering your fencing details',
    'Confirming your details',
    isComparing ? 'Comparing your quote against the market' : 'Finding your best local matches',
  ]

  const heading = activeIndex === 3 ? (isComparing ? 'Comparing your quote' : 'Finalising your quote') : 'Analysing your project'
  const subheading =
    activeIndex === 3
      ? isComparing
        ? "We're lining up your quote against other local businesses."
        : "We're matching you with the best local fencing businesses."
      : 'Our AI is working through your project details.'

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24 animate-[fade-in-up_0.4s_ease-out]">
      <div className="relative mb-10 flex h-3 items-center justify-center gap-2.5">
        <span className="absolute -top-22 -left-17.5 h-48 w-48 animate-pulse rounded-full bg-[#00261C] opacity-10" />
        <span className="h-3 w-3 rounded-full bg-[#00261C] animate-[dot-pulse_1.2s_ease-in-out_infinite]" />
        <span className="h-3 w-3 rounded-full bg-[#00261C] animate-[dot-pulse_1.2s_ease-in-out_infinite_0.2s]" />
        <span className="h-3 w-3 rounded-full bg-[#00261C] animate-[dot-pulse_1.2s_ease-in-out_infinite_0.4s]" />
      </div>

      <div className="mb-12 flex max-w-2xl flex-col items-center gap-4 text-center">
        <h1 className="text-5xl leading-tight font-semibold tracking-tight text-[#062D27]">{heading}</h1>
        <p className="text-xl text-gray-500">{subheading}</p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3">
        {cards.map((label, i) => {
          const state: CardState = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending'

          return (
            <div
              key={label}
              style={{ transitionDelay: `${i * 60}ms` }}
              className={`flex flex-col rounded-2xl border p-4 transition-all duration-500 ${
                state === 'active'
                  ? 'scale-[1.02] border-gray-100 bg-white shadow-md'
                  : state === 'done'
                    ? 'border-gray-100 bg-white shadow-sm'
                    : 'border-gray-50 bg-white/30 opacity-40'
              }`}
            >
              <div className="flex items-center gap-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  {state === 'done' && (
                    <span
                      style={{ animationDelay: `${i * 80}ms` }}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 animate-[pop-in_0.4s_ease-out_backwards]"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2} className="h-4 w-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                  {state === 'active' && (
                    <span className="h-2 w-2 rounded-full bg-[#00261C] animate-[dot-pulse_1s_ease-in-out_infinite]" />
                  )}
                  {state === 'pending' && <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />}
                </span>
                <span
                  className={`text-sm font-medium transition-colors duration-300 ${state === 'pending' ? 'text-gray-500' : 'text-[#062D27]'}`}
                >
                  {label}
                </span>
              </div>

              <div
                className={`grid transition-[grid-template-rows] duration-400 ease-in-out ${
                  state === 'active' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="pt-4 pl-10">
                    <ActiveCardDetail index={i} checklist={checklist} />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
