import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatWindow, type ChatMessage } from '../components/ChatWindow'
import { ChecklistPanel } from '../components/ChecklistPanel'
import { Header } from '../components/Header'
import { HeroInputScreen } from '../components/HeroInputScreen'
import { QuoteComparisonPage } from '../components/QuoteComparisonPage'
import { ThinkingScreen } from '../components/ThinkingScreen'
import { useVoiceCall } from '../hooks/useVoiceCall'
import {
  FENCING_CHAT_FALLBACK_MESSAGE,
  FencingChatError,
  sendFencingChatMessage,
  type ChatOption,
  type ChecklistData,
  type ChecklistDisplay,
  type ComparisonSummary,
  type FencingChatResponse,
} from '../services/fencingChat'
import { isPlacesConfigured, newSessionToken, searchSuburbs, suburbSearchQuery, type SuburbPlace } from '../services/places'
import { isQuoteResultReady, listenQuoteResult } from '../services/quoteResults'
import { saveQuote, type QuoteSession } from '../services/quotes'
import { isVoiceCallConfigured } from '../services/voice'
import { useAuth } from '../hooks/useAuth'
import { diffFilledField } from '../utils/checklist'
import { workerMatchesToComparison } from '../utils/comparison'
import { generateId } from '../utils/id'

// The whole conversation now happens in the chat thread — `thinking` only plays once, after the
// user has confirmed their brief and the workflow goes off to rank businesses. There is no
// `results` stage: both flows finish on the comparison page, which renders off `comparison`
// state rather than off a stage.
type Stage = 'hero' | 'chat' | 'thinking'

// What a homepage chip locks the backend onto. Chips not listed here still go to chat;
// the workflow reads the description and picks the trade itself.
const CHIP_TRADE: Record<string, string> = {
  Fence: 'fencing',
  Deck: 'decking',
  'Retaining Wall': 'retaining-wall',
  Tiling: 'tiling',
}
const KNOWN_TRADES = new Set(Object.values(CHIP_TRADE))

// A turn that is asking where the job is. The workflow says so with `expects`, but the client
// does not depend on it getting that right: a suburb typed as free text silently matches zero
// businesses, so the wording is checked here too.
const ASKS_FOR_SUBURB = /suburbs?|post ?code|whereabouts/i

function buildPrefill(type: string) {
  return `I need a ${type.toLowerCase()} — `
}

// A conversation being reopened from the Quotes tab, or nothing for a fresh one.
export function Home({
  initialSession,
  initialView = 'result',
}: {
  initialSession?: QuoteSession | null
  /** Which face of a reopened quote to show first — its result, or its conversation. */
  initialView?: 'chat' | 'result'
}) {
  const { user } = useAuth()
  const [stage, setStage] = useState<Stage>(initialSession ? 'chat' : 'hero')
  const [description, setDescription] = useState('')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState(() => initialSession?.sessionId ?? generateId())
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialSession?.messages ?? [])
  const [intent, setIntent] = useState<'new_quote' | 'compare_quote' | undefined>(initialSession?.intent)
  const [trade, setTrade] = useState<string | null>(() => initialSession?.trade ?? null)
  const [lastFailedText, setLastFailedText] = useState<string | null>(null)
  const [lastFailedFiles, setLastFailedFiles] = useState<File[] | null>(null)
  // Whatever the turn currently in flight is carrying — the wait says what it's reading.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null)
  const [comparison, setComparison] = useState<ComparisonSummary | null>(initialSession?.comparison ?? null)
  const [isLoading, setIsLoading] = useState(false)
  const [checklist, setChecklist] = useState<ChecklistData | null>(initialSession?.checklist ?? null)
  const [checklistDisplay, setChecklistDisplay] = useState<ChecklistDisplay | null>(
    initialSession?.checklistDisplay ?? null,
  )
  const [checklistComplete, setChecklistComplete] = useState(false)
  const [resultId, setResultId] = useState<string | undefined>(initialSession?.resultId)
  const [resultMessage, setResultMessage] = useState<string | undefined>(initialSession?.resultMessage)
  const [noMatchReason, setNoMatchReason] = useState<string | undefined>(initialSession?.noMatchReason)
  // Stays put across every save, so reopening a quote doesn't keep resetting when it began.
  const startedAt = useRef(initialSession?.createdAt ?? Date.now())
  // A finished quote has two faces and the customer picks which one they are looking at. The
  // conversation is not a transcript: answering again from there re-runs the quote.
  const [view, setView] = useState<'chat' | 'result'>(initialView)
  // The Google place behind the suburb the customer picked. Kept for the whole session so
  // postcode/state/coordinates ride along on every later turn, not just the one that set it.
  const [place, setPlace] = useState<SuburbPlace | null>(initialSession?.place ?? null)
  // The message whose option row just collapsed, waiting to be told which checklist field it filled.
  const pendingAnswerId = useRef<string | null>(null)

  // The whole conversation is one record, rewritten whenever it changes — a dozen turns is a
  // small document, and a write per message would cost a dozen times as much to store the same
  // thing. Nothing is saved until the customer has actually said something.
  // Built once and used twice: saved as the history, and handed to the Instant Quote flow,
  // which renders it as the PDF attached to the job. Two shapes of the same conversation would
  // drift the moment one of them gained a field.
  const quoteSession: QuoteSession = useMemo(
    () => ({
      sessionId,
      status: comparison ? 'complete' : 'in_progress',
      createdAt: startedAt.current,
      updatedAt: Date.now(),
      messages: messages.map(({ id, role, text, options, answered, answeredField, isConfirmation, checklist: turnChecklist, expects, alternatives, checklistDisplay: turnDisplay }) => ({
        id,
        role,
        text,
        options,
        answered,
        answeredField,
        isConfirmation,
        checklist: turnChecklist,
        expects,
        alternatives,
        checklistDisplay: turnDisplay ?? undefined,
      })),
      checklist,
      checklistDisplay: checklistDisplay ?? undefined,
      place,
      comparison,
      intent,
      trade,
      resultId,
      resultMessage,
      noMatchReason,
    }),
    [messages, checklist, checklistDisplay, place, comparison, intent, trade, sessionId, resultId, resultMessage, noMatchReason],
  )

  useEffect(() => {
    if (quoteSession.messages.length === 0) return
    saveQuote(quoteSession, user)
  }, [quoteSession, user])

  const intentRef = useRef(intent)
  intentRef.current = intent
  const tradeRef = useRef(trade)
  tradeRef.current = trade
  const checklistRef = useRef(checklist)
  checklistRef.current = checklist
  const stopVoiceRef = useRef<() => void>(() => {})

  const applyTurn = useCallback(
    (response: FencingChatResponse, previousChecklist: ChecklistData | null, answeredId: string | null, fromVoice = false) => {
      // The server's place always wins — sending last turn's picker object after the customer
      // moved suburb is what reopens the suburb question.
      setPlace(response.place ?? null)

      const hasQuoteToBeat = Number(response.checklist?.existingPrice) > 0
      if (response.intent && (!intentRef.current || (response.intent === 'compare_quote' && hasQuoteToBeat))) {
        setIntent(response.intent)
      }
      if (!tradeRef.current && response.trade && KNOWN_TRADES.has(response.trade)) setTrade(response.trade)
      if (response.checklist) setChecklist(response.checklist)
      if (response.checklistDisplay) setChecklistDisplay(response.checklistDisplay)
      setChecklistComplete(response.checklistComplete ?? false)
      if (response.resultId) setResultId(response.resultId)
      if (response.noMatchReason !== undefined) setNoMatchReason(response.noMatchReason)

      const filledField = diffFilledField(previousChecklist, response.checklist)
      const labelAnswer = (previous: ChatMessage[]) =>
        answeredId && filledField
          ? previous.map((m) => (m.id === answeredId ? { ...m, answeredField: filledField } : m))
          : previous

      const isResultPage =
        (response.intent === 'compare_quote' && !!response.comparison) || response.type === 'result'
      if (isResultPage) {
        stopVoiceRef.current()
        setComparison(response.comparison ?? workerMatchesToComparison(response.results ?? []))
        setResultMessage(response.message)
        setView('result')
        return
      }

      const expectsSuburb =
        isPlacesConfigured() && (response.expects === 'suburb' || ASKS_FOR_SUBURB.test(response.message))
      const turn = {
        id: generateId(),
        role: 'ai' as const,
        text: response.message,
        options: response.options,
        checklist: response.checklist ?? previousChecklist,
        checklistDisplay: response.checklistDisplay,
        isConfirmation: response.type === 'confirmation',
        expects: expectsSuburb ? ('suburb' as const) : undefined,
        alternatives: response.alternatives,
      }

      setMessages((previous) => {
        const labelled = labelAnswer(previous)
        if (fromVoice) {
          const last = labelled.at(-1)
          if (last?.role === 'ai' && !last.answered) return [...labelled.slice(0, -1), { ...turn, id: last.id }]
        }
        return [...labelled, turn]
      })

      if (expectsSuburb && response.suggestedSuburb) void prefillSuburb(turn.id, response.suggestedSuburb)
    },
    [],
  )

  const { status: voiceStatus, start: startVoice, stop: stopVoice, isActive: isVoiceActive } = useVoiceCall({
    sessionId,
    place,
    knownChecklist: checklist,
    onUiUpdate: (response) => applyTurn(response, checklistRef.current, null, true),
    onEnded: (endedResultId) => {
      if (endedResultId) setResultId(endedResultId)
    },
  })
  stopVoiceRef.current = stopVoice

  useEffect(() => {
    if (!resultId) return
    let cancelled = false
    let unsub: (() => void) | undefined
    void listenQuoteResult(resultId, (doc) => {
      if (!isQuoteResultReady(doc)) return
      if (doc.comparison) setComparison(doc.comparison)
      else if (doc.results) setComparison(workerMatchesToComparison(doc.results))
      if (doc.message) setResultMessage(doc.message)
      if (doc.noMatchReason !== undefined) setNoMatchReason(doc.noMatchReason)
      if (doc.place !== undefined) setPlace(doc.place ?? null)
      if (doc.checklist) setChecklist(doc.checklist)
      if (doc.checklistDisplay) setChecklistDisplay(doc.checklistDisplay)
      setView('result')
    }).then((stop) => {
      if (cancelled) stop()
      else unsub = stop
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [resultId])

  async function sendMessage(
    apiText: string,
    quoteFiles?: File[] | null,
    isFinalConfirm = false,
    // Passed explicitly by the turn that just confirmed a suburb — `place` state hasn't
    // re-rendered yet at that point.
    confirmedPlace?: SuburbPlace | null,
  ) {
    setIsLoading(true)
    setPendingFiles(quoteFiles ?? null)
    // Captured before the request so the response can be diffed against it — that diff is what
    // labels the answer chip the user just collapsed.
    const previousChecklist = checklist
    const answeredId = pendingAnswerId.current
    pendingAnswerId.current = null
    if (isFinalConfirm) setStage('thinking')

    try {
      // Checklist goes back exactly as the API gave it — including `_ui`. Never rebuild or
      // null fields out; that is what breaks "more options" paging and re-asks answered questions.
      const response = await sendFencingChatMessage(apiText, sessionId, quoteFiles, {
        knownChecklist: previousChecklist,
        place: confirmedPlace ?? place,
      })
      applyTurn(response, previousChecklist, answeredId)
    } catch (error) {
      const chatError = error instanceof FencingChatError ? error : null
      const customerMessage = chatError?.message ?? FENCING_CHAT_FALLBACK_MESSAGE
      // Unknown failures (malformed body, thrown Error) stay retryable — the customer can try again.
      const retryable = chatError ? chatError.retryable : true
      const code = chatError?.code ?? 'client'

      // Dev-only detail — never put `code` / status in the bubble.
      console.error('[fencing-chat]', {
        code,
        status: chatError?.status,
        retryable,
        sessionId: chatError?.sessionId ?? sessionId,
        message: customerMessage,
      })
      if (code === 'too_fast') {
        console.warn(
          '[fencing-chat] too_fast — likely a client loop (double-send / missing loading guard), not a fast user',
        )
      }

      // Error bodies echo the checklist — keep the brief rather than wiping it.
      if (chatError?.checklist) {
        setChecklist(chatError.checklist)
        if (typeof chatError.checklistComplete === 'boolean') {
          setChecklistComplete(chatError.checklistComplete)
        }
      }

      if (retryable) {
        setLastFailedText(apiText)
        setLastFailedFiles(quoteFiles ?? null)
      } else {
        setLastFailedText(null)
        setLastFailedFiles(null)
      }

      setMessages((previous) => [
        ...previous,
        {
          id: generateId(),
          role: 'ai',
          text: customerMessage,
          isError: true,
          retryable,
          checklist: chatError?.checklist ?? previousChecklist,
        },
      ])
    } finally {
      setIsLoading(false)
      // The thinking screen only ever covers the wait, so the wait ending always ends it —
      // including the turn that produced a result, which used to return early and leave `stage`
      // pinned on 'thinking'. Nothing showed it while `comparison` held the results page, so it
      // sat there until "View chat" dropped through to it and span forever. One exit for every
      // path: a reply, a result, or an error.
      setStage('chat')
    }
  }

  // An MCQ pick is its own record in the thread — the tile row collapses to the chosen answer,
  // so it deliberately does *not* also push a user bubble echoing the same thing back.
  const handleSelectOption = (messageId: string, option: ChatOption) => {
    if (isLoading) return
    const target = messages.find((m) => m.id === messageId)
    pendingAnswerId.current = messageId
    setMessages((previous) => previous.map((m) => (m.id === messageId ? { ...m, answered: option } : m)))
    void sendMessage(String(option.value), undefined, !!target?.isConfirmation && String(option.value) === 'yes')
  }

  // A suburb the customer picked from Google, rather than one they typed. `answeredField` is
  // set outright instead of being diffed out of the next checklist — this turn is the suburb
  // by definition, so the chip never has to wait a round trip to know what it filled in.
  const handleSelectPlace = (messageId: string, selected: SuburbPlace) => {
    if (isLoading) return
    setPlace(selected)
    setMessages((previous) =>
      previous.map((m) =>
        m.id === messageId
          ? { ...m, answered: { label: selected.displayLabel, value: selected.displayLabel }, answeredField: 'suburb' }
          : m,
      ),
    )
    void sendMessage(selected.displayLabel, undefined, false, selected)
  }

  // While a suburb is outstanding the composer stops being a straight line to the workflow:
  // whatever gets typed is looked up against Google first, and only a place the customer then
  // confirms is sent on. A typo that would have quietly matched zero businesses gets caught
  // here, without spending a workflow turn on it.
  /** Fills the picker on an existing turn with what Google makes of a place already named. */
  async function prefillSuburb(messageId: string, text: string) {
    const sessionToken = newSessionToken()
    try {
      const suggestions = await searchSuburbs(suburbSearchQuery(text), sessionToken)
      if (suggestions.length === 0) return
      setMessages((previous) =>
        previous.map((message) =>
          message.id === messageId ? { ...message, suggestions, query: text, sessionToken } : message,
        ),
      )
    } catch {
      // The picker still works by typing — a failed head start is not worth an error message.
    }
  }

  async function resolveTypedSuburb(text: string) {
    setIsLoading(true)
    const sessionToken = newSessionToken()
    try {
      // A quote document carries a whole street address, which a region search matches nothing
      // against — so the searchable part is pulled out first, and the raw text is only tried
      // again if that finds nothing.
      const query = suburbSearchQuery(text)
      let suggestions = await searchSuburbs(query, sessionToken)
      if (suggestions.length === 0 && query !== text) suggestions = await searchSuburbs(text, sessionToken)
      setMessages((previous) => [
        ...previous,
        {
          id: generateId(),
          role: 'ai',
          text: suggestions.length
            ? "Here's what I found in Australia — which one is yours?"
            : `I couldn't find "${text}" as an Australian suburb. Try the suburb name on its own, or its postcode.`,
          expects: 'suburb',
          suggestions,
          query: text,
          sessionToken,
        },
      ])
    } catch {
      setMessages((previous) => [
        ...previous,
        {
          id: generateId(),
          role: 'ai',
          text: "Suburb search isn't responding right now. Type your suburb again in a moment.",
          expects: 'suburb',
          query: text,
          sessionToken,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = (text: string) => {
    setMessages((previous) => [...previous, { id: generateId(), role: 'user', text }])
    const lastAi = messages.findLast((m) => m.role === 'ai')
    // Typed into the composer instead of the picker: look it up rather than sending it on. The
    // suburb only ever reaches the workflow as a place the customer confirmed from Google's
    // suggestions — that is the whole point of asking for it this way.
    const isSuburbTurn = lastAi?.expects === 'suburb' || (!!lastAi && ASKS_FOR_SUBURB.test(lastAi.text))
    if (isPlacesConfigured() && isSuburbTurn && !lastAi?.answered) {
      void resolveTypedSuburb(text)
      return
    }
    void sendMessage(text)
  }

  const handleRetry = () => {
    if (!lastFailedText) return
    setMessages((previous) => previous.filter((m) => !m.isError))
    void sendMessage(lastFailedText, lastFailedFiles)
  }

  const handleHeroSubmit = (quoteFiles: File[]) => {
    setStage('chat')
    setMessages([{ id: generateId(), role: 'user', text: description }])
    void sendMessage(description, quoteFiles)
  }

  const handleStartVoice = () => {
    setStage('chat')
    if (description.trim() && messages.length === 0) {
      setMessages([{ id: generateId(), role: 'user', text: description.trim() }])
    }
    void startVoice(description.trim() || undefined)
  }

  const handleRestart = () => {
    stopVoice()
    setSessionId(generateId())
    setMessages([])
    setIntent(undefined)
    setTrade(null)
    setLastFailedText(null)
    setLastFailedFiles(null)
    setComparison(null)
    setDescription('')
    setSelectedType(null)
    setChecklist(null)
    setChecklistDisplay(null)
    setChecklistComplete(false)
    setResultId(undefined)
    setResultMessage(undefined)
    setNoMatchReason(undefined)
    setPlace(null)
    pendingAnswerId.current = null
    startedAt.current = Date.now()
    setStage('hero')
  }

  // Where every finished conversation lands, whichever intent it ran under (Figma: "Quote
  // Direct Comparison").
  if (comparison && view === 'result') {
    return (
      <QuoteComparisonPage
        comparison={comparison}
        message={resultMessage}
        intent={intent}
        place={place}
        quoteSession={quoteSession}
        onBack={handleRestart}
        onViewChat={() => setView('chat')}
      />
    )
  }

  // The thread owns the viewport: the page itself never scrolls, the message list and the
  // brief sidebar each scroll on their own so the composer stays put.
  if (stage === 'chat') {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-[#FCFDFD]">
        <Header onNewProject={handleRestart} onHome={handleRestart} />
        {/* Only once a quote exists: the way back to it, and a reminder that carrying the
            conversation on will produce a new one. */}
        {comparison && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#D1FAE5] bg-[#ECFDF5] px-6 py-3 sm:px-10">
            <p className="text-sm text-[#047857]">
              This quote is ready. Keep chatting to change it, or go back to your results.
            </p>
            <button
              type="button"
              onClick={() => setView('result')}
              className="rounded-full bg-[#059669] px-4 py-2 text-sm font-semibold whitespace-nowrap text-white transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#047857]"
            >
              View results
            </button>
          </div>
        )}
        <div className="grid min-h-0 flex-1 overflow-hidden border-t border-gray-200 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <ChatWindow
            messages={messages}
            isLoading={isLoading}
            pendingFiles={pendingFiles}
            trade={trade}
            voiceStatus={voiceStatus}
            onSend={handleSend}
            onSelectOption={handleSelectOption}
            onSelectPlace={handleSelectPlace}
            onRetry={handleRetry}
            onStartVoice={isVoiceCallConfigured() ? handleStartVoice : undefined}
            onHangUp={isVoiceActive ? stopVoice : undefined}
          />
          <ChecklistPanel checklist={checklist} checklistDisplay={checklistDisplay} />
        </div>
      </div>
    )
  }

  if (stage === 'thinking') {
    return (
      <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
        <Header dimmed />
        <ThinkingScreen
          description={description}
          checklist={checklist}
          checklistComplete={checklistComplete}
          awaitingResult
          intent={intent}
          trade={trade}
          selectedType={selectedType}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FCFDFD]">
      <Header onNewProject={handleRestart} onHome={handleRestart} />

      {stage === 'hero' && (
        <HeroInputScreen
          description={description}
          onDescriptionChange={setDescription}
          selectedType={selectedType}
          onSelectType={(type) => {
            setDescription((d) => {
              const isEmpty = !d.trim()
              const matchesPriorPrefill = selectedType !== null && d === buildPrefill(selectedType)
              return isEmpty || matchesPriorPrefill ? buildPrefill(type) : d
            })
            setSelectedType(type)
            setTrade(CHIP_TRADE[type] ?? null)
          }}
          onSubmit={handleHeroSubmit}
          onStartVoice={isVoiceCallConfigured() ? handleStartVoice : undefined}
        />
      )}

      <footer className="flex justify-center py-8">
        <p className="text-xs text-gray-400">
          Photos, PDFs and video walkthroughs are analysed privately. Nothing is shared without your consent.
        </p>
      </footer>
    </div>
  )
}
