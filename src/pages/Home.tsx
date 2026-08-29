import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatWindow, type ChatMessage } from '../components/ChatWindow'
import { ChecklistPanel } from '../components/ChecklistPanel'
import { Header } from '../components/Header'
import { HeroInputScreen } from '../components/HeroInputScreen'
import { QuoteComparisonPage } from '../components/QuoteComparisonPage'
import { ThinkingScreen } from '../components/ThinkingScreen'
import { useAuth } from '../hooks/useAuth'
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
import { isQuoteResultReady, fetchQuoteResult, listenQuoteResult, type QuoteResultDoc } from '../services/quoteResults'
import { saveQuote, type QuoteSession } from '../services/quotes'
import { isVoiceCallConfigured, freshVoiceTurns, lastVoiceTurnN, VOICE_RATE_LIMIT_MESSAGE, type ChecklistAnsweredItem, type ChecklistPendingItem, type VoiceCallContext, type VoiceSession } from '../services/voice'
import { sortMessagesByTime, withCreatedAt } from '../utils/chatTimeline'
import { mergeChecklistData, mergeChecklistDisplay } from '../utils/checklistMerge'
import { diffFilledField } from '../utils/checklist'
import { workerMatchesToComparison } from '../utils/comparison'
import { generateId } from '../utils/id'
import { mergeVoiceTurns, voiceModeOffDivider, voiceModeOnDivider } from '../utils/voiceMessages'

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

function toStoredMessages(thread: ChatMessage[]) {
  return thread.map(
    ({
      id,
      role,
      text,
      createdAt,
      isVoice,
      options,
      answered,
      answeredField,
      isConfirmation,
      checklist: turnChecklist,
      expects,
      alternatives,
      checklistDisplay: turnDisplay,
    }) => ({
      id,
      role,
      text,
      createdAt,
      isVoice,
      options,
      answered,
      answeredField,
      isConfirmation,
      checklist: turnChecklist,
      expects,
      alternatives,
      checklistDisplay: turnDisplay ?? undefined,
    }),
  )
}

function applyChecklistAnsweredState(
  answered: ChecklistAnsweredItem[] | undefined,
  setAnswered: (value: ChecklistAnsweredItem[]) => void,
) {
  if (answered === undefined || answered.length === 0) return
  setAnswered(answered)
}

function voiceContextFromState(input: {
  checklist: ChecklistData | null
  place: SuburbPlace | null
  responseOptions: ChatOption[]
  checklistDisplay: ChecklistDisplay | null
  checklistAnswered: ChecklistAnsweredItem[]
  messages: ChatMessage[]
}): VoiceCallContext {
  const lastAi = input.messages.findLast((message) => message.role === 'ai')
  return {
    checklist: input.checklist,
    place: input.place,
    options: input.responseOptions.length ? input.responseOptions : null,
    message: lastAi?.text ?? '',
    checklistDisplay: input.checklistDisplay,
    checklistAnswered: input.checklistAnswered,
  }
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
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const base = initialSession?.createdAt ?? Date.now()
    return (initialSession?.messages ?? []).map((message, index) => ({
      ...message,
      createdAt: message.createdAt ?? base + index,
    }))
  })
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
  const [checklistAnswered, setChecklistAnswered] = useState<ChecklistAnsweredItem[]>(
    () => initialSession?.checklistAnswered ?? [],
  )
  const [checklistPending, setChecklistPending] = useState<ChecklistPendingItem[]>(
    () => initialSession?.checklistPending ?? [],
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
  const [voiceServerReady, setVoiceServerReady] = useState(true)
  const [voicePreparing, setVoicePreparing] = useState(false)
  const [voiceSessionId, setVoiceSessionId] = useState(() => initialSession?.voiceSessionId)
  const [responseOptions, setResponseOptions] = useState<ChatOption[]>(() => initialSession?.responseOptions ?? [])
  const [lastResponseType, setLastResponseType] = useState<FencingChatResponse['type'] | undefined>(
    () => initialSession?.lastTurnType,
  )
  // The message whose option row just collapsed, waiting to be told which checklist field it filled.
  const pendingAnswerId = useRef<string | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  /** Only navigate to the results face when a result is produced this sitting, not on re-open. */
  const shouldAutoShowResult = useRef(false)
  /** Last voice turn number already merged into messages — keyed by `n`, not array index. Greeting is 0. */
  const voiceSyncedTurnN = useRef(-1)
  const voiceSessionIdRef = useRef(voiceSessionId)
  voiceSessionIdRef.current = voiceSessionId

  const commitMessages = useCallback((next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessages((prev) => {
      const raw = typeof next === 'function' ? next(prev) : next
      const sorted = sortMessagesByTime(raw, startedAt.current)
      messagesRef.current = sorted
      return sorted
    })
  }, [])

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
      messages: toStoredMessages(messages),
      checklist,
      checklistDisplay: checklistDisplay ?? undefined,
      checklistAnswered: checklistAnswered.length ? checklistAnswered : undefined,
      checklistPending: checklistPending.length ? checklistPending : undefined,
      place,
      comparison,
      intent,
      trade,
      resultId,
      resultMessage,
      noMatchReason,
      responseOptions: responseOptions.length ? responseOptions : undefined,
      lastTurnType: lastResponseType,
      voiceSessionId,
    }),
    [
      messages,
      checklist,
      checklistDisplay,
      checklistAnswered,
      checklistPending,
      place,
      comparison,
      intent,
      trade,
      sessionId,
      resultId,
      resultMessage,
      noMatchReason,
      responseOptions,
      lastResponseType,
      voiceSessionId,
    ],
  )

  useEffect(() => {
    const worthSaving =
      quoteSession.messages.length > 0 || quoteSession.status === 'complete' || !!quoteSession.resultId
    if (!worthSaving) return
    saveQuote(quoteSession, user)
  }, [quoteSession, user])

  useEffect(() => {
    if (view === 'chat') setStage('chat')
  }, [view])

  const applyQuoteResultDoc = useCallback((doc: QuoteResultDoc) => {
    if (doc.comparison) setComparison(doc.comparison)
    else if (doc.results) setComparison(workerMatchesToComparison(doc.results))
    if (doc.message) setResultMessage(doc.message)
    if (doc.noMatchReason !== undefined) setNoMatchReason(doc.noMatchReason)
    if (doc.place !== undefined) setPlace(doc.place ?? null)
    if (doc.checklist) setChecklist(doc.checklist)
    if (doc.checklistDisplay) setChecklistDisplay(doc.checklistDisplay)
  }, [])

  const intentRef = useRef(intent)
  intentRef.current = intent
  const tradeRef = useRef(trade)
  tradeRef.current = trade
  const stopVoiceRef = useRef<() => void>(() => {})

  const applyVoiceSessionState = useCallback((session: VoiceSession) => {
    if (session.place !== undefined) setPlace(session.place ?? null)
    if (session.checklist !== undefined) {
      setChecklist((previous) => mergeChecklistData(previous, session.checklist))
    }
    if (session.checklistDisplay !== undefined) {
      setChecklistDisplay((previous) => mergeChecklistDisplay(previous, session.checklistDisplay))
    }
    applyChecklistAnsweredState(session.checklistAnswered, setChecklistAnswered)
    if (session.checklistPending !== undefined) setChecklistPending(session.checklistPending ?? [])
    setResponseOptions(session.options ?? [])
    if (session.type) setLastResponseType(session.type)
  }, [])

  const mergeVoiceSessionTurns = useCallback((session: VoiceSession): ChatMessage[] => {
    const sid = voiceSessionIdRef.current
    if (!sid) return messagesRef.current

    const lastSeen = voiceSyncedTurnN.current
    const fresh = freshVoiceTurns(session.turns, lastSeen)
    if (!fresh.length) return messagesRef.current

    voiceSyncedTurnN.current = lastVoiceTurnN(session.turns, lastSeen)
    const nextMessages = mergeVoiceTurns(messagesRef.current, fresh, sid)
    commitMessages(nextMessages)
    return messagesRef.current
  }, [commitMessages])

  const handleVoiceSessionSync = useCallback(
    (session: VoiceSession) => {
      if (!session.found) return
      applyVoiceSessionState(session)
      mergeVoiceSessionTurns(session)
    },
    [applyVoiceSessionState, mergeVoiceSessionTurns],
  )

  const applyTurn = useCallback(
    (response: FencingChatResponse, previousChecklist: ChecklistData | null, answeredId: string | null) => {
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
      applyChecklistAnsweredState(response.checklistAnswered, setChecklistAnswered)
      if (response.checklistPending) setChecklistPending(response.checklistPending)
      setChecklistComplete(response.checklistComplete ?? false)
      if (response.resultId) {
        shouldAutoShowResult.current = true
        setResultId(response.resultId)
      }
      if (response.noMatchReason !== undefined) setNoMatchReason(response.noMatchReason)
      setResponseOptions(response.options ?? [])
      setLastResponseType(response.type)

      const filledField = diffFilledField(previousChecklist, response.checklist)
      const labelAnswer = (previous: ChatMessage[]) =>
        answeredId && filledField
          ? previous.map((m) => (m.id === answeredId ? { ...m, answeredField: filledField } : m))
          : previous

      const isResultPage =
        (response.intent === 'compare_quote' && !!response.comparison) || response.type === 'result'
      if (isResultPage) {
        stopVoiceRef.current()
        shouldAutoShowResult.current = true
        setComparison(response.comparison ?? workerMatchesToComparison(response.results ?? []))
        setResultMessage(response.message)
        setView('result')
        return
      }

      const expectsSuburb =
        isPlacesConfigured() && (response.expects === 'suburb' || ASKS_FOR_SUBURB.test(response.message))
      const turn = withCreatedAt({
        id: generateId(),
        role: 'ai' as const,
        text: response.message,
        options: response.options,
        checklist: response.checklist ?? previousChecklist,
        checklistDisplay: response.checklistDisplay,
        isConfirmation: response.type === 'confirmation',
        expects: expectsSuburb ? ('suburb' as const) : undefined,
        alternatives: response.alternatives,
      })

      commitMessages((previous) => {
        const labelled = labelAnswer(previous)
        return [...labelled, turn]
      })

      if (expectsSuburb && response.suggestedSuburb) void prefillSuburb(turn.id, response.suggestedSuburb)
    },
    [commitMessages],
  )

  const handleVoiceHandover = useCallback(
    (session: VoiceSession | null, voiceSessionIdFromCall: string) => {
      if (voiceSessionIdFromCall) setVoiceSessionId(voiceSessionIdFromCall)

      const openChat = () => setStage('chat')

      if (!session?.found) {
        openChat()
        commitMessages((previous) => [
          ...previous,
          withCreatedAt({
            id: generateId(),
            role: 'ai',
            text: "That call didn't save properly. Tap the microphone to try again.",
          }),
        ])
        return
      }

      if (session.place !== undefined) setPlace(session.place ?? null)
      if (session.checklist !== undefined) {
        setChecklist((previous) => mergeChecklistData(previous, session.checklist))
      }
      if (session.checklistDisplay !== undefined) {
        setChecklistDisplay((previous) => mergeChecklistDisplay(previous, session.checklistDisplay))
      }
      applyChecklistAnsweredState(session.checklistAnswered, setChecklistAnswered)
      if (session.checklistPending !== undefined) setChecklistPending(session.checklistPending ?? [])
      setResponseOptions(session.options ?? [])
      setLastResponseType(session.type)

      mergeVoiceSessionTurns(session)
      const nextMessages = messagesRef.current

      if (session.resultId) {
        shouldAutoShowResult.current = true
        setResultId(session.resultId)

        void (async () => {
          const doc = await fetchQuoteResult(session.resultId!)
          let nextComparison = comparison
          let nextResultMessage = resultMessage
          let nextNoMatchReason = noMatchReason
          let nextPlace = place
          let nextChecklist = checklist
          let nextChecklistDisplay = checklistDisplay
          let nextChecklistAnswered = checklistAnswered

          if (doc && isQuoteResultReady(doc)) {
            nextComparison =
              doc.comparison ?? (doc.results ? workerMatchesToComparison(doc.results) : null) ?? nextComparison
            if (doc.message) nextResultMessage = doc.message
            if (doc.noMatchReason !== undefined) nextNoMatchReason = doc.noMatchReason
            if (doc.place !== undefined) nextPlace = doc.place ?? null
            if (doc.checklist) nextChecklist = doc.checklist
            if (doc.checklistDisplay) nextChecklistDisplay = doc.checklistDisplay
            applyQuoteResultDoc(doc)
          }

          saveQuote(
            {
              sessionId,
              status: 'complete',
              createdAt: startedAt.current,
              updatedAt: Date.now(),
              messages: toStoredMessages(nextMessages),
              checklist: session.checklist ?? nextChecklist,
              checklistDisplay: nextChecklistDisplay ?? undefined,
              checklistAnswered: nextChecklistAnswered.length ? nextChecklistAnswered : undefined,
              checklistPending: session.checklistPending?.length ? session.checklistPending : undefined,
              place: session.place ?? nextPlace,
              comparison: nextComparison,
              intent,
              trade,
              resultId: session.resultId,
              resultMessage: nextResultMessage,
              noMatchReason: nextNoMatchReason,
              responseOptions: session.options ?? [],
              lastTurnType: session.type,
              voiceSessionId: voiceSessionIdFromCall || voiceSessionId,
            },
            user,
          )

          openChat()
          setView('result')
        })()
        return
      }

      openChat()
    },
    [
      applyQuoteResultDoc,
      checklist,
      checklistDisplay,
      checklistAnswered,
      comparison,
      intent,
      noMatchReason,
      place,
      resultMessage,
      sessionId,
      trade,
      user,
      mergeVoiceSessionTurns,
      voiceSessionId,
      commitMessages,
    ],
  )

  const showVoice = isVoiceCallConfigured() && voiceServerReady

  const { status: voiceStatus, start: startVoice, stop: stopVoice, isActive: isVoiceActive } = useVoiceCall({
    onSessionStarted: (id) => {
      voiceSyncedTurnN.current = -1
      setVoiceSessionId(id)
      voiceSessionIdRef.current = id
    },
    onCallStarted: () => {
      const sid = voiceSessionIdRef.current
      if (!sid) return
      commitMessages((previous) => [...previous, voiceModeOnDivider(sid)])
    },
    onCallEnding: () => {
      const sid = voiceSessionIdRef.current
      if (sid) {
        commitMessages((previous) => [...previous, voiceModeOffDivider(sid)])
      }
      setStage('thinking')
    },
    onHandover: handleVoiceHandover,
    onSessionSync: handleVoiceSessionSync,
    onConfigureUnavailable: () => setVoiceServerReady(false),
    onRateLimited: () => {
      commitMessages((previous) => [
        ...previous,
        withCreatedAt({ id: generateId(), role: 'ai', text: VOICE_RATE_LIMIT_MESSAGE }),
      ])
    },
    onStartFailed: (message) => {
      commitMessages((previous) => [
        ...previous,
        withCreatedAt({ id: generateId(), role: 'ai', text: message, isError: true, retryable: true }),
      ])
    },
  })
  stopVoiceRef.current = stopVoice

  useEffect(() => {
    if (!resultId) return
    let cancelled = false
    let unsub: (() => void) | undefined
    void listenQuoteResult(resultId, (doc) => {
      if (!isQuoteResultReady(doc)) return
      applyQuoteResultDoc(doc)
      if (shouldAutoShowResult.current) {
        setView('result')
        shouldAutoShowResult.current = false
      }
    }).then((stop) => {
      if (cancelled) stop()
      else unsub = stop
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [resultId, applyQuoteResultDoc])

  async function sendMessage(
    apiText: string,
    quoteFiles?: File[] | null,
    isFinalConfirm = false,
    // Passed explicitly by the turn that just confirmed a suburb — `place` state hasn't
    // re-rendered yet at that point.
    confirmedPlace?: SuburbPlace | null,
  ): Promise<FencingChatResponse | null> {
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
      return response
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
      if (chatError?.checklistDisplay) setChecklistDisplay(chatError.checklistDisplay)
      applyChecklistAnsweredState(chatError?.checklistAnswered, setChecklistAnswered)
      if (chatError?.checklistPending) setChecklistPending(chatError.checklistPending)

      if (retryable) {
        setLastFailedText(apiText)
        setLastFailedFiles(quoteFiles ?? null)
      } else {
        setLastFailedText(null)
        setLastFailedFiles(null)
      }

      commitMessages((previous) => [
        ...previous,
        withCreatedAt({
          id: generateId(),
          role: 'ai',
          text: customerMessage,
          isError: true,
          retryable,
          checklist: chatError?.checklist ?? previousChecklist,
        }),
      ])
      return null
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
    commitMessages((previous) => previous.map((m) => (m.id === messageId ? { ...m, answered: option } : m)))
    void sendMessage(String(option.value), undefined, !!target?.isConfirmation && String(option.value) === 'yes')
  }

  // A suburb the customer picked from Google, rather than one they typed. `answeredField` is
  // set outright instead of being diffed out of the next checklist — this turn is the suburb
  // by definition, so the chip never has to wait a round trip to know what it filled in.
  const handleSelectPlace = (messageId: string, selected: SuburbPlace) => {
    if (isLoading) return
    setPlace(selected)
    commitMessages((previous) =>
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
      commitMessages((previous) =>
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
      commitMessages((previous) => [
        ...previous,
        withCreatedAt({
          id: generateId(),
          role: 'ai',
          text: suggestions.length
            ? "Here's what I found in Australia — which one is yours?"
            : `I couldn't find "${text}" as an Australian suburb. Try the suburb name on its own, or its postcode.`,
          expects: 'suburb',
          suggestions,
          query: text,
          sessionToken,
        }),
      ])
    } catch {
      commitMessages((previous) => [
        ...previous,
        withCreatedAt({
          id: generateId(),
          role: 'ai',
          text: "Suburb search isn't responding right now. Type your suburb again in a moment.",
          expects: 'suburb',
          query: text,
          sessionToken,
        }),
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = (text: string) => {
    commitMessages((previous) => [...previous, withCreatedAt({ id: generateId(), role: 'user', text })])
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
    commitMessages((previous) => previous.filter((m) => !m.isError))
    void sendMessage(lastFailedText, lastFailedFiles)
  }

  const handleHeroSubmit = (quoteFiles: File[]) => {
    setStage('chat')
    commitMessages([withCreatedAt({ id: generateId(), role: 'user', text: description })])
    void sendMessage(description, quoteFiles)
  }

  const handleStartVoice = (quoteFiles: File[] | unknown = []) => {
    if (voicePreparing || isLoading || isVoiceActive) return
    const files = Array.isArray(quoteFiles) ? quoteFiles : []
    setVoicePreparing(true)
    setStage('chat')
    void (async () => {
      try {
        const hasPdf = files.some((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
        let context: VoiceCallContext

        if (hasPdf) {
          const text = description.trim() || messagesRef.current.find((message) => message.role === 'user')?.text || ''
          if (text && messagesRef.current.length === 0) {
            commitMessages([withCreatedAt({ id: generateId(), role: 'user', text })])
          }
          const response = await sendMessage(text, files)
          if (!response) return
          context = {
            checklist: response.checklist ?? checklist,
            place: response.place ?? place,
            options: response.options?.length ? response.options : null,
            message: response.message,
            checklistDisplay: response.checklistDisplay ?? checklistDisplay,
            checklistAnswered: response.checklistAnswered ?? checklistAnswered,
          }
        } else {
          context = voiceContextFromState({
            checklist,
            place,
            responseOptions,
            checklistDisplay,
            checklistAnswered,
            messages: messagesRef.current,
          })
        }

        await startVoice(context)
      } finally {
        setVoicePreparing(false)
      }
    })()
  }

  const handleRestart = () => {
    stopVoice()
    setSessionId(generateId())
    commitMessages([])
    setIntent(undefined)
    setTrade(null)
    setLastFailedText(null)
    setLastFailedFiles(null)
    setComparison(null)
    setDescription('')
    setSelectedType(null)
    setChecklist(null)
    setChecklistDisplay(null)
    setChecklistAnswered([])
    setChecklistPending([])
    setChecklistComplete(false)
    setResultId(undefined)
    setResultMessage(undefined)
    setNoMatchReason(undefined)
    setPlace(null)
    setResponseOptions([])
    setLastResponseType(undefined)
    setVoiceSessionId(undefined)
    voiceSyncedTurnN.current = -1
    setVoicePreparing(false)
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
        onViewChat={() => {
          setView('chat')
          setStage('chat')
        }}
      />
    )
  }

  const voiceBusy = isLoading || voicePreparing || isVoiceActive
  const voicePreparingLabel =
    voicePreparing && isLoading && pendingFiles?.some((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
      ? 'Reading your document…'
      : voicePreparing
        ? 'Connecting…'
        : undefined

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
            voicePreparing={voicePreparing}
            voicePreparingLabel={voicePreparingLabel}
            pendingOptions={
              !isVoiceActive && !voicePreparing && !resultId && responseOptions.length ? responseOptions : undefined
            }
            pendingTurnType={!resultId ? lastResponseType : undefined}
            pendingChecklist={!resultId ? checklist : undefined}
            pendingChecklistAnswered={!resultId ? checklistAnswered : undefined}
            interactionDisabled={isVoiceActive}
            onSend={handleSend}
            onSelectOption={handleSelectOption}
            onSelectPlace={handleSelectPlace}
            onRetry={handleRetry}
            onStartVoice={showVoice && !voiceBusy ? handleStartVoice : undefined}
            onHangUp={isVoiceActive ? stopVoice : undefined}
          />
          <ChecklistPanel checklistAnswered={checklistAnswered} checklistPending={checklistPending} />
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
          onStartVoice={showVoice ? handleStartVoice : undefined}
          voiceDisabled={voiceBusy}
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
