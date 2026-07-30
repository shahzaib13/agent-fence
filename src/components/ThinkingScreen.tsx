import { useEffect, useState } from 'react'

const PROCESSING_STEPS = [
  'Reading your description',
  'Matching you with local fencing pros',
  'Comparing rates nearby',
  'Getting your first question ready',
]

const STEP_DURATION_MS = 900

export function ThinkingScreen() {
  const [doneCount, setDoneCount] = useState(0)

  useEffect(() => {
    const delay = doneCount >= PROCESSING_STEPS.length ? 1200 : STEP_DURATION_MS
    const timer = setTimeout(() => setDoneCount((c) => (c + 1) % (PROCESSING_STEPS.length + 1)), delay)
    return () => clearTimeout(timer)
  }, [doneCount])

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24">
      <div className="relative mb-10 flex h-3 items-center justify-center gap-2.5">
        <span className="absolute -top-22 -left-17.5 h-48 w-48 animate-pulse rounded-full bg-[#00261C] opacity-10" />
        <span className="h-3 w-3 rounded-full bg-[#00261C] animate-[dot-pulse_1.2s_ease-in-out_infinite]" />
        <span className="h-3 w-3 rounded-full bg-[#00261C] animate-[dot-pulse_1.2s_ease-in-out_infinite_0.2s]" />
        <span className="h-3 w-3 rounded-full bg-[#00261C] animate-[dot-pulse_1.2s_ease-in-out_infinite_0.4s]" />
      </div>

      <div className="mb-12 flex max-w-2xl flex-col items-center gap-4 text-center">
        <h1 className="text-5xl leading-tight font-semibold tracking-tight text-[#062D27]">
          Analysing your project
        </h1>
        <p className="text-xl text-gray-500">Our AI is matching your description with local fencing businesses.</p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3">
        {PROCESSING_STEPS.map((step, i) => {
          const state = i < doneCount ? 'done' : i === doneCount ? 'active' : 'pending'
          return (
            <div
              key={step}
              className={`flex items-center gap-4 rounded-2xl border p-4 transition-all duration-500 ${
                state === 'active'
                  ? 'scale-[1.02] border-gray-100 bg-white shadow-md'
                  : state === 'done'
                    ? 'border-gray-100 bg-white shadow-sm'
                    : 'border-gray-50 bg-white/30 opacity-40'
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                {state === 'done' && (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100">
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
                {step}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
