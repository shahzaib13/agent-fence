import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWordReveal } from '../hooks/useWordReveal'
import type { VoiceStatus } from '../hooks/useVoiceCall'
import {
  OTHER_OPTION_VALUE,
  type AlternativeOffer,
  type ChatOption,
  type ChecklistData,
  type ChecklistDisplay,
} from '../services/fencingChat'
import type { SuburbPlace, SuburbSuggestion } from '../services/places'
import { checklistFieldLabel } from '../utils/checklist'
import { AlternativeOffers } from './AlternativeOffers'
import { ConfirmationCard } from './ConfirmationCard'
import { SuburbPicker } from './SuburbPicker'
import { VoiceBar } from './VoiceBar'

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  options?: ChatOption[]
  // Only carried by `confirmation` turns — the recap card renders it inline in the thread.
  checklist?: ChecklistData | null
  isConfirmation?: boolean
  // Set the instant the user picks a tile: the whole option row collapses down to just this one.
  answered?: ChatOption
  // This turn wants a suburb, so it renders the Google-backed picker instead of relying on the
  // composer. `suggestions`/`query` are only set on the local turn that answers a typed reply —
  // the picker opens pre-loaded with what that text matched, so confirming is one click.
  expects?: 'suburb'
  alternatives?: AlternativeOffer[]
  checklistDisplay?: ChecklistDisplay | null
  suggestions?: SuburbSuggestion[]
  query?: string
  // Carried from the search that produced `suggestions` so the details lookup that follows
  // bills as part of the same Places session rather than opening a second one.
  sessionToken?: string
  // Which checklist field that pick filled in. Only knowable once the *next* response comes
  // back (Home diffs the checklist), so the collapsed chip shows the bare label until then.
  answeredField?: string
  isError?: boolean
  /** When `isError`, whether to show Try again. Omitted on older threads → treat as retryable. */
  retryable?: boolean
}

function CheckBadge() {
  return (
    <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#062D27] animate-[pop-in_0.35s_ease-out]">
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} className="h-2.5 w-2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  )
}

// `__other__` is never a button — the box sits next to the real tiles. Legacy flows use a
// numeric length box; fencing accepts any free-text answer.
function CustomAnswer({
  mode,
  disabled,
  autoFocus,
  onSubmit,
}: {
  mode: 'numeric' | 'text'
  disabled: boolean
  autoFocus?: boolean
  onSubmit: (value: string | number) => void
}) {
  const [value, setValue] = useState('')
  const metres = Number(value)
  const isNumericUsable = Number.isFinite(metres) && metres > 0 && metres <= 1000
  const isTextUsable = value.trim().length > 0

  if (mode === 'text') {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = value.trim()
          if (isTextUsable && !disabled) onSubmit(trimmed)
        }}
        className="flex flex-wrap items-center gap-2.5 animate-[card-rise_0.3s_ease-out_backwards]"
      >
        <label htmlFor="custom-answer" className="sr-only">
          Your answer
        </label>
        <input
          id="custom-answer"
          type="text"
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Type your answer"
          className="min-w-48 flex-1 rounded-2xl border border-[#062D27]/40 bg-white px-4 py-3 text-sm font-medium text-[#062D27] placeholder:text-gray-300 focus:outline-none focus:shadow-[0_4px_20px_rgba(6,45,39,0.06)] disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!isTextUsable || disabled}
          className="rounded-2xl bg-[#062D27] px-4 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#0a3f37] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
        >
          Use this
        </button>
      </form>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (isNumericUsable && !disabled) onSubmit(metres)
      }}
      className="flex flex-wrap items-center gap-2.5 animate-[card-rise_0.3s_ease-out_backwards]"
    >
      <label htmlFor="custom-length" className="sr-only">
        Length in metres
      </label>
      <div className="flex items-center gap-2 rounded-2xl border border-[#062D27]/40 bg-white py-2.5 pr-3 pl-4 focus-within:shadow-[0_4px_20px_rgba(6,45,39,0.06)]">
        <input
          id="custom-length"
          type="number"
          inputMode="decimal"
          min={1}
          max={1000}
          step="any"
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="27"
          className="w-24 border-0 bg-transparent text-sm font-medium text-[#062D27] placeholder:text-gray-300 focus:outline-none"
        />
        <span className="text-sm text-gray-400">metres</span>
      </div>
      <button
        type="submit"
        disabled={!isNumericUsable || disabled}
        className="rounded-2xl bg-[#062D27] px-4 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#0a3f37] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
      >
        Use this
      </button>
    </form>
  )
}

function OptionRow({
  message,
  disabled,
  otherInputMode,
  onSelect,
}: {
  message: ChatMessage
  disabled: boolean
  otherInputMode: 'numeric' | 'text'
  onSelect: (option: ChatOption) => void
}) {
  const answered = message.answered
  const choices = (message.options ?? []).filter((option) => String(option.value) !== OTHER_OPTION_VALUE)
  const hasOther = (message.options ?? []).some((option) => String(option.value) === OTHER_OPTION_VALUE)

  if (answered) {
    const pickedFromRow = choices.find((option) => String(option.value) === String(answered.value))
    return (
      <span className="inline-flex items-center gap-2.5 rounded-2xl border border-[#062D27] bg-[#EFF6F5] px-4 py-2.5 animate-[pop-in_0.35s_ease-out]">
        <CheckBadge />
        <span className="text-sm font-semibold text-[#062D27]">
          {message.answeredField ? `${checklistFieldLabel(message.answeredField)}: ` : ''}
          {pickedFromRow?.label ?? answered.label}
        </span>
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {choices.length > 0 && (
        <div className="-mb-2.5 flex flex-wrap animate-[card-rise_0.45s_ease-out_backwards]">
          {choices.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(option)}
              className="relative mr-2.5 mb-2.5 min-w-36 overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 py-4 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-[#062D27]/40 hover:shadow-[0_6px_20px_rgba(6,45,39,0.08)] active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              <span className="text-sm font-medium text-gray-700">{option.label}</span>
            </button>
          ))}
        </div>
      )}
      {hasOther && (
        <CustomAnswer
          mode={otherInputMode}
          disabled={disabled}
          autoFocus={choices.length === 0}
          onSubmit={(value) =>
            onSelect(typeof value === 'number' ? { label: `${value}m`, value } : { label: value, value })
          }
        />
      )}
    </div>
  )
}

function AiTurn({
  message,
  animate,
  disabled,
  isLast,
  otherInputMode,
  onSelect,
  onSelectPlace,
  onRetry,
  onGrow,
}: {
  message: ChatMessage
  animate: boolean
  disabled: boolean
  isLast: boolean
  otherInputMode: 'numeric' | 'text'
  onSelect: (option: ChatOption) => void
  onSelectPlace: (place: SuburbPlace) => void
  onRetry: () => void
  onGrow: () => void
}) {
  const words = useMemo(() => message.text.split(' '), [message.text])
  const revealed = useWordReveal(words.length, animate)
  const revealDone = revealed >= words.length
  const hasOptions = !!message.options && message.options.length > 0
  const hasAlternatives = !!message.alternatives && message.alternatives.length > 0

  // Keep the thread pinned to the bottom as the reply reveals itself and its card drops in,
  // so the newest content stays in view without the user chasing it.
  useLayoutEffect(() => {
    onGrow()
  }, [revealed, revealDone, onGrow])

  return (
    <div className="flex flex-col gap-2 animate-[fade-in-up_0.35s_ease-out]">
      {/* Indented to the bubble's own left edge, not the avatar's — the avatar sits outside
          the column of content it belongs to. */}
      <p className="pl-12 text-xs font-medium tracking-wide text-gray-400">AI</p>
      <div className="flex items-end gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#062D27] text-sm font-semibold text-white">
          A
        </span>
        <div className="max-w-2xl rounded-3xl rounded-bl-lg border border-gray-100 bg-white px-5 py-4 shadow-[0_2px_14px_rgba(6,45,39,0.04)]">
          {/* Split into per-word spans only while the reveal is running; once every word has
              landed it collapses back to plain text, so the finished message is a normal
              selectable/announceable paragraph rather than a pile of spans. */}
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-[#0B3A33]">
            {revealDone
              ? message.text
              : words.map((word, index) => (
                  <span
                    key={`${index}-${word}`}
                    className={index < revealed ? 'animate-[word-in_0.34s_ease-out_backwards]' : 'opacity-0'}
                  >
                    {word}
                    {index < words.length - 1 ? ' ' : ''}
                  </span>
                ))}
          </p>
        </div>
      </div>

      {/* Everything the turn hands you to act on lines up with the bubble, past the avatar. */}
      <div className="pt-1 pl-12 empty:hidden">
        {message.isError && message.retryable !== false && (
          <button
            type="button"
            onClick={onRetry}
            className="w-fit rounded-full bg-[#062D27] px-5 py-2 text-sm font-medium text-white transition-all duration-150 hover:scale-105 hover:bg-[#0a3f37] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            Try again
          </button>
        )}

        {/* Cards wait for the sentence above them to finish landing — the reply reads first,
            then the thing you act on arrives. */}
        {revealDone && message.isConfirmation && message.checklist && (
          <ConfirmationCard
            checklist={message.checklist}
            checklistDisplay={message.checklistDisplay}
            options={message.options ?? []}
            answered={message.answered}
            disabled={disabled}
            onSelectOption={onSelect}
          />
        )}
        {revealDone && hasAlternatives && !message.isConfirmation && (
          <AlternativeOffers
            alternatives={message.alternatives ?? []}
            options={message.options ?? []}
            answered={message.answered}
            disabled={disabled}
            onSelect={onSelect}
          />
        )}
        {revealDone && hasOptions && !hasAlternatives && !message.isConfirmation && (
          <OptionRow message={message} disabled={disabled} otherInputMode={otherInputMode} onSelect={onSelect} />
        )}

        {/* A suburb turn answers itself through the picker, so the composer never has to carry
            it. Only the newest one stays live — earlier ones collapse to what was picked. */}
        {revealDone && message.expects === 'suburb' && message.answered && (
          <span className="inline-flex items-center gap-2.5 rounded-2xl border border-[#062D27] bg-[#EFF6F5] px-4 py-2.5 animate-[pop-in_0.35s_ease-out]">
            <CheckBadge />
            <span className="text-sm font-semibold text-[#062D27]">
              {checklistFieldLabel('suburb')}: {message.answered.label}
            </span>
          </span>
        )}
        {revealDone && message.expects === 'suburb' && !message.answered && isLast && (
          <SuburbPicker
            key={message.sessionToken ?? message.id}
            initialQuery={message.query}
            initialSuggestions={message.suggestions}
            sessionToken={message.sessionToken}
            disabled={disabled}
            onSelect={onSelectPlace}
          />
        )}
      </div>
    </div>
  )
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-end gap-2 animate-[fade-in-up_0.3s_ease-out]">
      <p className="text-xs font-medium tracking-wide text-gray-400">You</p>
      <p className="max-w-xl rounded-3xl rounded-br-lg bg-[#EFF3F2] px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-[#0B3A33]">
        {text}
      </p>
    </div>
  )
}

// What the shimmer says while a turn is in flight. A turn carrying attachments gets its own
// script: "Thinking" while a PDF is being read says nothing about the part actually taking
// the time, and the wait on those turns is the long one.
const THINKING_LINES = {
  none: ['Thinking', 'Reading your answer', 'Checking local pricing', 'Lining up businesses'],
  file: ['Reading your document', 'Extracting the details from it', 'Checking local pricing', 'Lining up businesses'],
  image: ['Looking at your photos', 'Working out what they show', 'Checking local pricing', 'Lining up businesses'],
  both: [
    'Reading what you sent',
    'Extracting the details from your document',
    'Working out what your photos show',
    'Checking local pricing',
  ],
}

function scriptFor(files: File[] | null | undefined) {
  const hasFile = !!files?.some((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
  const hasImage = !!files?.some((file) => file.type.startsWith('image/'))
  if (hasFile && hasImage) return THINKING_LINES.both
  if (hasFile) return THINKING_LINES.file
  if (hasImage) return THINKING_LINES.image
  return THINKING_LINES.none
}

const TICK_MS = 400
// Ticks spent on one line before it swaps — 8 × 400ms, so the dots cycle twice per phrase.
const TICKS_PER_LINE = 8

function PendingTurn({ files }: { files?: File[] | null }) {
  const lines = scriptFor(files)
  // A stalled request reads as a broken one. One interval drives both tells: the dots cycle
  // every tick, the phrase swaps every eighth, so the bubble is never still while we wait.
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex flex-col gap-3 animate-[fade-in-up_0.3s_ease-out]">
      <p className="text-[11px] font-medium tracking-wide text-gray-400">AI</p>
      <div className="flex items-end gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#062D27] text-sm font-semibold text-white">
          A
        </span>
        <div
          className="w-full max-w-md rounded-3xl rounded-bl-lg border border-gray-100 bg-white px-5 py-5 shadow-[0_2px_14px_rgba(6,45,39,0.04)]"
          role="status"
          aria-label="Waiting for a reply"
        >
          {/* One steady announcement for screen readers — the rotating line below is decoration
              and would otherwise re-announce itself every few seconds. */}
          <span className="sr-only">{lines[0]}…</span>
          {/* The same sweep the shimmer bars use, clipped to the text itself. */}
          <span
            aria-hidden="true"
            className="mb-3.5 flex text-sm font-medium bg-[linear-gradient(90deg,#9CA3AF_0%,#9CA3AF_38%,#062D27_50%,#9CA3AF_62%,#9CA3AF_100%)] bg-size-[300%_100%] bg-clip-text text-transparent animate-[shimmer-sweep_2.2s_linear_infinite]"
          >
            {lines[Math.floor(tick / TICKS_PER_LINE) % lines.length]}
            {/* Fixed width so the line doesn't twitch sideways as dots come and go. */}
            <span className="w-4 shrink-0 text-left">{'.'.repeat(tick % 4)}</span>
          </span>
          <span className="flex flex-col gap-2.5" aria-hidden="true">
            {['w-11/12', 'w-full', 'w-2/3'].map((width, index) => (
              <span
                key={width}
                className={`h-2.5 rounded-full bg-[linear-gradient(90deg,#EDF1F0_0%,#EDF1F0_38%,#FAFCFB_50%,#EDF1F0_62%,#EDF1F0_100%)] bg-size-[300%_100%] animate-[shimmer-sweep_1.5s_linear_infinite] ${width}`}
                style={{ animationDelay: `${index * 0.12}s` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ChatWindow({
  messages,
  isLoading,
  pendingFiles,
  trade,
  voiceStatus,
  onSend,
  onSelectOption,
  onSelectPlace,
  onRetry,
  onStartVoice,
  onHangUp,
}: {
  messages: ChatMessage[]
  isLoading: boolean
  pendingFiles?: File[] | null
  trade?: string | null
  voiceStatus?: VoiceStatus
  onSend: (text: string) => void
  onSelectOption: (messageId: string, option: ChatOption) => void
  onSelectPlace: (messageId: string, place: SuburbPlace) => void
  onRetry: () => void
  onStartVoice?: () => void
  onHangUp?: () => void
}) {
  const otherInputMode = trade === 'fencing' ? 'text' : 'numeric'
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  // Whether the user is currently reading the newest content. Tracked from actual scrolling
  // rather than measured at growth time — a tall card dropping in moves the bottom away by
  // more than any sane threshold, and would look exactly like someone scrolling up.
  const isPinned = useRef(true)
  const lastAiId = messages.findLast((m) => m.role === 'ai')?.id

  // Follow the bottom of the thread, but never yank someone who has scrolled up to re-read
  // an earlier turn. Jumps rather than smooth-scrolls on purpose: the reveal grows the thread
  // a line at a time, so following it frame by frame already reads as motion, and a running
  // smooth-scroll animation would keep firing scroll events that look like the user leaving.
  const stickToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el || !isPinned.current) return
    el.scrollTop = el.scrollHeight
  }, [])

  useLayoutEffect(() => {
    stickToBottom()
  }, [messages.length, isLoading, stickToBottom])

  // Grow the composer with what's being typed, up to the max height its own class sets —
  // past that the textarea keeps its height and scrolls. Resetting to `auto` first is what
  // lets it shrink back again when text is deleted.
  useLayoutEffect(() => {
    const el = draftRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget
          isPinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 sm:px-10 [overflow-anchor:none]"
      >
        <div className="mx-auto flex w-full max-w-400 flex-col gap-8 py-10">
          {messages.map((message) =>
            message.role === 'user' ? (
              <UserTurn key={message.id} text={message.text} />
            ) : (
              <AiTurn
                key={message.id}
                message={message}
                animate={message.id === lastAiId}
                disabled={isLoading}
                isLast={message.id === lastAiId}
                otherInputMode={otherInputMode}
                onSelect={(option) => onSelectOption(message.id, option)}
                onSelectPlace={(place) => onSelectPlace(message.id, place)}
                onRetry={onRetry}
                onGrow={stickToBottom}
              />
            ),
          )}
          {isLoading && <PendingTurn files={pendingFiles} />}
        </div>
      </div>

      {voiceStatus && voiceStatus !== 'idle' && voiceStatus !== 'error' && onHangUp ? (
        <VoiceBar status={voiceStatus} onHangUp={onHangUp} />
      ) : (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim() || isLoading) return
          onSend(draft.trim())
          setDraft('')
        }}
        className="border-t border-gray-100 px-6 py-5 sm:px-10"
      >
        {/* items-end so the send button stays level with the last line once the box has grown. */}
        <div className="mx-auto flex w-full max-w-400 items-end gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2 transition-all focus-within:border-[#062D27]/40 focus-within:shadow-[0_4px_20px_rgba(6,45,39,0.06)]">
          <label htmlFor="chat-reply" className="sr-only">
            Your reply
          </label>
          <textarea
            id="chat-reply"
            ref={draftRef}
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter starts a new line — same bargain as the hero textarea.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            disabled={isLoading}
            placeholder="Type your response..."
            autoComplete="off"
            className="max-h-40 flex-1 resize-none overflow-y-auto border-0 bg-transparent py-2 text-[15px] leading-relaxed text-[#062D27] placeholder:text-gray-300 focus:outline-none disabled:cursor-not-allowed"
          />
          {onStartVoice && (
            <button
              type="button"
              aria-label="Start voice call"
              disabled={isLoading}
              onClick={onStartVoice}
              className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-400 transition-all duration-150 hover:bg-[#EFF6F5] hover:text-[#062D27] active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0M12 17v3" />
              </svg>
            </button>
          )}
          <button
            type="submit"
            aria-label="Send message"
            disabled={!draft.trim() || isLoading}
            className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-400 transition-all duration-150 hover:bg-[#EFF6F5] hover:text-[#062D27] active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062D27]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.5 2.5L10.5 13.5M21.5 2.5l-7 19-4-9-9-4z" />
            </svg>
          </button>
        </div>
      </form>
      )}
    </div>
  )
}
