import type { VoiceStatus } from '../hooks/useVoiceCall'

export function VoiceBar({
  status,
  onHangUp,
  preparingLabel,
}: {
  status: VoiceStatus
  onHangUp?: () => void
  /** Shown instead of Connecting/Listening/Speaking while the mic is not live yet. */
  preparingLabel?: string
}) {
  const speaking = status === 'speaking'
  const connecting = status === 'connecting'
  const label = preparingLabel ?? (connecting ? 'Connecting' : speaking ? 'Speaking' : 'Listening')

  return (
    <div className="border-t border-gray-100 px-6 py-5 sm:px-10">
      <div className="mx-auto flex w-full max-w-400 items-center gap-3 rounded-2xl border border-[#062D27]/20 bg-[#062D27] px-4 py-3 text-white">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 ${
            speaking ? 'animate-[pop-in_0.35s_ease-out]' : connecting ? 'opacity-70' : ''
          }`}
          aria-hidden="true"
        >
          {speaking ? (
            <span className="flex items-end gap-0.5">
              <span className="h-2 w-0.5 animate-pulse bg-white" />
              <span className="h-4 w-0.5 animate-pulse bg-white [animation-delay:120ms]" />
              <span className="h-3 w-0.5 animate-pulse bg-white [animation-delay:240ms]" />
            </span>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0M12 17v3" />
            </svg>
          )}
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium" role="status" aria-live="polite">
          {label}
        </p>
        {onHangUp ? (
          <button
            type="button"
            onClick={onHangUp}
            aria-label="End voice call"
            className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Hang up
          </button>
        ) : null}
      </div>
    </div>
  )
}
